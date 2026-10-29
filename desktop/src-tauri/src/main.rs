#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod auth;
mod checkout;
mod config;
mod events;
mod routes;
mod steam;
mod steam_overlay;
mod stores;
#[cfg(feature = "updater")]
mod updater;
#[cfg(windows)]
mod webview_runtime;
use serde_json::{json, Value};
use std::sync::Mutex;
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_deep_link::DeepLinkExt;

#[tauri::command]
async fn desktop_call(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    channel: String,
    args: Vec<Value>,
) -> Result<Value, String> {
    let url = window.url().map_err(|e| e.to_string())?;
    if window.label() != "main" || !trusted_url(&url) {
        return Err("Untrusted desktop caller".into());
    }
    #[cfg(feature = "updater")]
    if channel.starts_with("updater:") {
        let pending = app
            .try_state::<updater::PendingUpdate>()
            .ok_or("This installation updates through its store")?;
        return match channel.as_str() {
            "updater:check" => Ok(json!(updater::updater_check(app.clone(), pending).await?)),
            "updater:download" => {
                updater::updater_download(app.clone(), pending).await?;
                Ok(Value::Null)
            }
            "updater:install" => {
                updater::updater_install(app.clone(), pending).await?;
                Ok(Value::Null)
            }
            _ => Err("Unknown updater command".into()),
        };
    }
    if channel.starts_with("auth:") {
        return auth::call(&app, &channel, &args).await;
    }
    if channel.starts_with("steam:") {
        return steam::call(&app, &channel, &args).await;
    }
    if channel.starts_with("iap:") || channel.starts_with("msstore:") {
        return stores::call(&app, &window, &channel, &args).await;
    }
    match channel.as_str() {
        #[cfg(debug_assertions)]
        "runtime:smokeReport" => {
            let path = std::env::var("TIAO_SMOKE_REPORT").map_err(|_| "Smoke mode is disabled")?;
            std::fs::write(path, serde_json::to_vec_pretty(&args.first()).unwrap())
                .map_err(|e| e.to_string())?;
            app.exit(0);
            Ok(Value::Null)
        }
        "runtime:ready" => {
            let state = app.state::<Mutex<events::Events>>();
            let mut state = state.lock().unwrap();
            state.ready = true;
            Ok(json!(std::mem::take(&mut state.pending)))
        }
        "runtime:openExternal" => {
            let url = args.first().and_then(Value::as_str).ok_or("Invalid URL")?;
            if !config::external(url) {
                return Err("Invalid external URL".into());
            }
            open::that(url).map_err(|e| e.to_string())?;
            Ok(Value::Null)
        }
        "window:isFullScreen" => Ok(json!(window.is_fullscreen().map_err(|e| e.to_string())?)),
        "window:setFullScreen" => {
            let enabled = args
                .first()
                .and_then(Value::as_bool)
                .ok_or("Invalid fullscreen setting")?;
            window.set_fullscreen(enabled).map_err(|e| e.to_string())?;
            if let Ok(path) = app.path().app_config_dir() {
                let _ = std::fs::create_dir_all(&path);
                let _ = std::fs::write(
                    path.join("window.json"),
                    json!({"fullscreen":enabled}).to_string(),
                );
            }
            events::send(&app, "window:fullScreenChanged", json!(enabled));
            Ok(Value::Null)
        }
        "window:quit" => {
            app.exit(0);
            Ok(Value::Null)
        }
        _ => Err("Unknown desktop command".into()),
    }
}
fn trusted_url(url: &url::Url) -> bool {
    if !url.username().is_empty() || url.password().is_some() || url.port().is_some() {
        return false;
    }
    (url.scheme() == "tauri" && url.host_str() == Some("localhost"))
        || (matches!(url.scheme(), "http" | "https") && url.host_str() == Some("tauri.localhost"))
}
fn links(app: &tauri::AppHandle, args: Vec<String>) {
    for arg in args.iter().filter(|arg| arg.starts_with("tiao:")) {
        if matches!(config::CHANNEL, "direct" | "itch") {
            if let Some(returned) = checkout::parse(arg) {
                let payload = match returned {
                    checkout::Return::Session(id) => json!({"sessionId":id}),
                    checkout::Return::Cancelled => json!({"cancelled":true}),
                };
                events::send(app, "checkout:return", payload);
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
                continue;
            }
        }
        tauri::async_runtime::spawn(auth::deep_link(app.clone(), arg.clone()));
    }
    steam::join_from_args(app, args);
}
fn main() {
    #[cfg(windows)]
    {
        webview_runtime::configure_under_wine();
        webview_runtime::exit_if_missing_under_wine();
    }
    assert!(
        ["direct", "itch", "steam", "steam-demo", "mas", "msstore"].contains(&config::CHANNEL),
        "Invalid distribution channel"
    );
    // Steam hooks must exist before the WebView creates its graphics device.
    if let Err(error) = steam::init() {
        eprintln!("Steam unavailable: {error}");
    }
    #[allow(unused_mut)]
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, args, _| {
            // The single-instance plugin forwards OAuth URLs to deep-link first.
            steam::join_from_args(app, args);
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_deep_link::init())
        .manage(Mutex::new(auth::Auth::default()))
        .manage(Mutex::new(events::Events::default()))
        .invoke_handler(tauri::generate_handler![desktop_call]);
    #[cfg(feature = "updater")]
    {
        assert_eq!(config::CHANNEL, "direct", "Store builds cannot self-update");
        builder = updater::register(builder);
    }
    let mut context = tauri::generate_context!();
    routes::install(&mut context);
    #[cfg(debug_assertions)]
    if std::env::var_os("TIAO_SMOKE_REPORT").is_some() {
        context.config_mut().identifier = "com.ricoslabs.tiao.smoke".into();
    }
    let app = builder
        .setup(|app| {
            let config = config::renderer();
            let mut script =
                include_str!("../../bridge.js").replace("__TIAO_CONFIG__", &config.to_string());
            if cfg!(debug_assertions) && std::env::var_os("TIAO_SMOKE_REPORT").is_some() {
                script = format!("HTMLMediaElement.prototype.play=async()=>{{}};for(const key of [\"AudioContext\",\"webkitAudioContext\"]){{const Original=window[key];if(Original){{Original.prototype.resume=async()=>{{}};window[key]=class extends Original{{constructor(...args){{super(...args);this.suspend();}}}};}}}}{script}");
            }
            let start = if cfg!(debug_assertions) && std::env::var_os("TIAO_SMOKE_GAME").is_some() {
                "en/computer/?autostart=1&difficulty=1&color=white&boardSize=9&scoreToWin=5"
            } else {
                "en/"
            };
            let fullscreen = app
                .path()
                .app_config_dir()
                .ok()
                .and_then(|path| std::fs::read(path.join("window.json")).ok())
                .and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok())
                .and_then(|value| value["fullscreen"].as_bool())
                .unwrap_or(false);
            let title = if config::CHANNEL == "steam-demo" {
                "Tiao 跳 Demo"
            } else {
                "Tiao 跳"
            };
            let window = WebviewWindowBuilder::new(app, "main", WebviewUrl::App(start.into()))
                .title(title)
                .on_document_title_changed(move |window, _| {
                    let _ = window.set_title(title);
                })
                .background_color(tauri::window::Color(26, 15, 6, 255))
                .visible(!cfg!(debug_assertions) || std::env::var_os("TIAO_SMOKE_REPORT").is_none())
                .inner_size(1280., 800.)
                .min_inner_size(800., 600.)
                .fullscreen(fullscreen)
                .initialization_script(script)
                .on_page_load(|webview, event| {
                    if matches!(event.event(), tauri::webview::PageLoadEvent::Started) {
                        webview
                            .state::<Mutex<events::Events>>()
                            .lock()
                            .unwrap()
                            .ready = false;
                    }
                    #[cfg(debug_assertions)]
                    if matches!(event.event(), tauri::webview::PageLoadEvent::Finished)
                        && std::env::var_os("TIAO_SMOKE_REPORT").is_some()
                    {
                        let _ = webview.eval(include_str!("smoke.js"));
                    }
                })
                .on_navigation(|url| {
                    if trusted_url(url) {
                        true
                    } else {
                        if config::external(url.as_str()) {
                            let _ = open::that(url.as_str());
                        }
                        false
                    }
                })
                .on_new_window(|url, _| {
                    if config::external(url.as_str()) {
                        let _ = open::that(url.as_str());
                    }
                    tauri::webview::NewWindowResponse::Deny
                })
                .build()?;
            #[cfg(debug_assertions)]
            if std::env::var("TIAO_DEVTOOLS").as_deref() == Ok("1") {
                window.open_devtools();
            }
            let _ = &window;
            if steam::active() {
                steam_overlay::install(app.handle());
            }
            stores::install(app.handle());
            steam::start_pump(app.handle());
            #[cfg(feature = "updater")]
            updater::start(app.handle().clone());
            let handle = app.handle().clone();
            app.deep_link().on_open_url(move |event| {
                links(
                    &handle,
                    event.urls().iter().map(ToString::to_string).collect(),
                )
            });
            if let Ok(Some(urls)) = app.deep_link().get_current() {
                links(
                    app.handle(),
                    urls.into_iter().map(|url| url.to_string()).collect(),
                );
            }
            steam::join_from_args(app.handle(), std::env::args().collect());
            #[cfg(any(windows, target_os = "linux"))]
            if std::env::var_os("TIAO_SMOKE_REPORT").is_none() {
                app.deep_link().register_all()?;
            }
            Ok(())
        })
        .build(context)
        .expect("Could not start Tiao");
    app.run(|app, event| match event {
        tauri::RunEvent::Exit => {
            steam_overlay::shutdown();
            steam::shutdown();
        }
        tauri::RunEvent::WindowEvent {
            event: tauri::WindowEvent::Destroyed,
            ..
        } => app.exit(0),
        tauri::RunEvent::WindowEvent {
            event: tauri::WindowEvent::Focused(true),
            ..
        } => {
            if let Some(window) = app.get_webview_window("main") {
                if let Ok(value) = window.is_fullscreen() {
                    events::send(app, "window:fullScreenChanged", json!(value));
                }
            }
        }
        _ => (),
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_local_tauri_documents_receive_privileges() {
        for value in [
            "tauri://localhost/en/",
            "http://tauri.localhost/en/",
            "https://tauri.localhost/en/",
        ] {
            assert!(trusted_url(&url::Url::parse(value).unwrap()));
        }
        for value in [
            "https://attacker.com/",
            "http://tauri.localhost:1234/",
            "tauri://evil/",
            "https://user@tauri.localhost/",
            "https://tauri.localhost.attacker.com/",
        ] {
            assert!(!trusted_url(&url::Url::parse(value).unwrap()), "{value}");
        }
    }
}
