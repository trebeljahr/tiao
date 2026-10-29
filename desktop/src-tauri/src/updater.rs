//! Desktop updates are downloaded and signature-verified before installation.
//! Installation remains separate from download so the frontend controls restart.
//! Steam installs keep this plugin disabled and update through Steam instead.

use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, Runtime, State};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};
use tauri_plugin_updater::{Update, UpdaterExt};

pub const PROGRESS_EVENT: &str = "updater://download-progress";

#[derive(Default)]
struct PendingRelease {
    update: Option<Update>,
    bytes: Option<Vec<u8>>,
    busy: bool,
}

#[derive(Default)]
pub(crate) struct PendingUpdate(Mutex<PendingRelease>);

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UpdateInfo {
    version: String,
    current_version: String,
    notes: Option<String>,
    date: Option<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct DownloadProgress {
    downloaded: u64,
    total: Option<u64>,
}

/// True when this process looks like it was launched from a Steam install.
///
/// Defense in depth behind the direct-only `updater` Cargo feature: even a
/// direct binary copied into a Steam installation must leave updates to Steam.
fn is_steam_runtime() -> bool {
    // Set by the Steam client for every process it launches.
    for key in [
        "SteamAppId",
        "SteamGameId",
        "SteamOverlayGameId",
        "SteamClientLaunch",
    ] {
        if std::env::var_os(key).is_some_and(|v| !v.is_empty()) {
            return true;
        }
    }

    let Ok(exe) = std::env::current_exe() else {
        return false;
    };

    // Dropped next to the executable so the Steamworks SDK can attach when the
    // game is started outside the client during development.
    if exe
        .parent()
        .is_some_and(|dir| dir.join("steam_appid.txt").exists())
    {
        return true;
    }

    // .../Steam/steamapps/common/<Game>/... on all three desktop platforms.
    exe.components()
        .any(|c| c.as_os_str().eq_ignore_ascii_case("steamapps"))
}

/// Check without discarding a verified download if the network check fails.
#[tauri::command]
pub(crate) async fn updater_check<R: Runtime>(
    app: AppHandle<R>,
    pending: State<'_, PendingUpdate>,
) -> Result<Option<UpdateInfo>, String> {
    if crate::config::CHANNEL != "direct" || is_steam_runtime() {
        return Err("This installation updates through its store".into());
    }
    let updater = app
        .updater_builder()
        .build()
        .map_err(|error| error.to_string())?;
    {
        let mut slot = pending.0.lock().map_err(|error| error.to_string())?;
        if slot.busy {
            return Err("An update operation is already in progress".into());
        }
        slot.busy = true;
    }
    let result = updater.check().await;
    let mut slot = pending.0.lock().map_err(|error| error.to_string())?;
    slot.busy = false;
    let update = result.map_err(|error| error.to_string())?;
    let info = update.as_ref().map(|update| UpdateInfo {
        version: update.version.clone(),
        current_version: update.current_version.clone(),
        notes: update.body.clone(),
        date: update.date.map(|date| date.to_string()),
    });
    // A repeat check for the same release keeps an already verified payload.
    if slot
        .update
        .as_ref()
        .map(|update| (&update.version, &update.signature))
        != update
            .as_ref()
            .map(|update| (&update.version, &update.signature))
    {
        slot.bytes = None;
    }
    slot.update = update;
    Ok(info)
}

/// Download verifies the payload signature. Retain it until a save flush permits
/// installation; retrying after a save failure needs neither a new check nor download.
#[tauri::command]
pub(crate) async fn updater_download<R: Runtime>(
    app: AppHandle<R>,
    pending: State<'_, PendingUpdate>,
) -> Result<(), String> {
    let update = {
        let mut slot = pending.0.lock().map_err(|error| error.to_string())?;
        if slot.busy {
            return Err("An update operation is already in progress".into());
        }
        if slot.bytes.is_some() {
            return Ok(());
        }
        let update = slot
            .update
            .clone()
            .ok_or("No pending update; check for updates first")?;
        slot.busy = true;
        update
    };
    let mut downloaded: u64 = 0;
    let result = update
        .download(
            move |chunk, total| {
                downloaded += chunk as u64;
                let _ = app.emit(PROGRESS_EVENT, DownloadProgress { downloaded, total });
            },
            || {},
        )
        .await;
    let mut slot = pending.0.lock().map_err(|error| error.to_string())?;
    slot.busy = false;
    slot.bytes = Some(result.map_err(|error| error.to_string())?);
    Ok(())
}

/// Install only a payload already verified by updater_download. The frontend
/// controls when it is safe to restart.
#[tauri::command]
pub(crate) async fn updater_install<R: Runtime>(
    app: AppHandle<R>,
    pending: State<'_, PendingUpdate>,
) -> Result<(), String> {
    let (update, bytes) = {
        let mut slot = pending.0.lock().map_err(|error| error.to_string())?;
        if slot.busy {
            return Err("An update operation is already in progress".into());
        }
        let update = slot
            .update
            .clone()
            .ok_or("No pending update; check for updates first")?;
        let bytes = slot
            .bytes
            .take()
            .ok_or("Download and verify the update before installing")?;
        slot.busy = true;
        (update, bytes)
    };
    if let Err(error) = update.install(&bytes) {
        let mut slot = pending.0.lock().map_err(|error| error.to_string())?;
        slot.busy = false;
        slot.bytes = Some(bytes);
        return Err(error.to_string());
    }
    // Windows starts its installer and exits inside install(). Other platforms
    // replace the bundle and return, then request the explicit restart here.
    app.restart();
}

/// Preserve the direct release's opt-in startup check and explicit restart.
/// Development builds and Steam installs must never contact an update feed.
pub fn start(app: AppHandle) {
    if cfg!(debug_assertions) || app.try_state::<PendingUpdate>().is_none() {
        return;
    }
    tauri::async_runtime::spawn(async move {
        let result = async {
            if updater_check(app.clone(), app.state()).await?.is_none() {
                return Ok::<_, String>(());
            }
            updater_download(app.clone(), app.state()).await?;
            let handle = app.clone();
            app.dialog()
                .message("A new version of Tiao is ready to install. The app will restart to apply the update.")
                .title("Update ready")
                .buttons(MessageDialogButtons::OkCancelCustom("Restart now".into(), "Later".into()))
                .show(move |restart| {
                    if restart {
                        tauri::async_runtime::spawn(async move {
                            if let Err(error) = updater_install(handle.clone(), handle.state()).await {
                                eprintln!("Could not install update: {error}");
                            }
                        });
                    }
                });
            Ok(())
        }.await;
        if let Err(error) = result {
            eprintln!("Could not check or download update: {error}");
        }
    });
}

/// Registers updater state and its plugin outside Steam installs. App commands
/// are registered together in main.rs.
pub fn register<R: Runtime>(builder: tauri::Builder<R>) -> tauri::Builder<R> {
    if crate::config::CHANNEL != "direct" || is_steam_runtime() {
        eprintln!("tiao: Steam runtime detected — in-app updater disabled");
        return builder;
    }

    builder
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .manage(PendingUpdate::default())
}
