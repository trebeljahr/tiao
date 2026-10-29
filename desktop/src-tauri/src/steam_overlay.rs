//! Native presentation and activation delivery; SDK availability alone does
//! not imply that the webview process provides an overlay render target.
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::OnceLock;
#[cfg(target_os = "macos")]
use tauri::Manager;
use tauri::{AppHandle, Emitter};

static APP: OnceLock<AppHandle> = OnceLock::new();
static ACTIVE: AtomicBool = AtomicBool::new(false);

#[cfg(target_os = "macos")]
#[no_mangle]
extern "C" fn tiao_overlay_needs_present() -> bool {
    ACTIVE.load(Ordering::SeqCst) || super::steam::overlay_needs_present()
}

#[cfg(target_os = "macos")]
extern "C" {
    fn tiao_overlay_attach(window: *mut std::ffi::c_void) -> bool;
    fn tiao_overlay_set_active(active: bool);
    fn tiao_overlay_stop();
}

pub(crate) fn install(app: &AppHandle) {
    let _ = APP.set(app.clone());
    #[cfg(debug_assertions)]
    if std::env::var("TIAO_DISABLE_OVERLAY_SURFACE").as_deref() == Ok("1") {
        eprintln!("Steam overlay surface disabled for diagnostic comparison");
        return;
    }
    #[cfg(target_os = "macos")]
    if let Some(window) = app.get_webview_window("main") {
        match window.ns_window() {
            // SAFETY: Tauri setup runs on the main thread and owns this NSWindow.
            Ok(window) if unsafe { tiao_overlay_attach(window) } => {
                unsafe { tiao_overlay_set_active(ACTIVE.load(Ordering::SeqCst)) };
                eprintln!("Steam overlay native Metal surface attached");
            }
            _ => eprintln!("Cannot attach native Steam overlay Metal surface"),
        }
    }
}

pub(crate) fn on_activation(active: bool) {
    if ACTIVE.swap(active, Ordering::SeqCst) == active {
        return;
    }
    eprintln!("Steam overlay active: {active}");
    if let Some(app) = APP.get() {
        let _ = app.emit("steam-overlay-active", active);
        #[cfg(target_os = "macos")]
        let _ = app.run_on_main_thread(move || {
            // SAFETY: View ordering is changed only on the main thread.
            unsafe { tiao_overlay_set_active(active) }
        });
    }
}

pub(crate) fn shutdown() {
    #[cfg(target_os = "macos")]
    // SAFETY: RunEvent::Exit is delivered on the main event-loop thread.
    unsafe {
        tiao_overlay_stop();
    }
}
