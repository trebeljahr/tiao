//! The Windows build renders in the Microsoft Edge WebView2 Runtime. Windows
//! 10 and 11 ship it, but a Proton or Wine prefix does not, and Tauri's own
//! "Could not find the WebView2 Runtime" dialog does not tell a Linux player
//! what to do. Under Wine, show the two ways out instead: the native Linux
//! build, or installing the runtime into the prefix.

const STEAM_APP_ID: &str = "5035580";

/// Wine currently fails UI Automation COM initialization and does not
/// implement the DirectComposition call WebView2 uses for this window. Apply
/// the two confirmed launch workarounds before any WebView2 code runs. Keep
/// real Windows and user-supplied overrides untouched.
pub(crate) fn configure_under_wine() {
    if !running_under_wine() {
        return;
    }
    let overrides = std::env::var("WINEDLLOVERRIDES").unwrap_or_default();
    if !has_uia_override(&overrides) && std::env::var_os("TIAO_WINE_RESTARTED").is_none() {
        let value = if overrides.is_empty() {
            "uiautomationcore=d".to_string()
        } else {
            format!("{overrides};uiautomationcore=d")
        };
        // Wine reads DLL overrides while starting a process. Restart once so
        // the override is active before uiautomationcore can load. Wait for
        // the child so Steam keeps tracking this game until it exits.
        let result = std::env::current_exe().and_then(|exe| {
            std::process::Command::new(exe)
                .args(std::env::args_os().skip(1))
                .env("WINEDLLOVERRIDES", value)
                .env("TIAO_WINE_RESTARTED", "1")
                .status()
        });
        match result {
            Ok(status) => std::process::exit(status.code().unwrap_or(1)),
            Err(error) => eprintln!("Cannot restart with Wine UI Automation workaround: {error}"),
        }
    }

    const FLAG: &str = "--disable-direct-composition";
    let args = std::env::var("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS").unwrap_or_default();
    if !args.split_whitespace().any(|arg| arg == FLAG) {
        let value = if args.is_empty() {
            FLAG.to_string()
        } else {
            format!("{args} {FLAG}")
        };
        std::env::set_var("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS", value);
    }
}

fn has_uia_override(overrides: &str) -> bool {
    overrides.split(';').any(|entry| {
        entry.split_once('=').is_some_and(|(dlls, _)| {
            dlls.split(',')
                .any(|dll| dll.trim().eq_ignore_ascii_case("uiautomationcore"))
        })
    })
}

#[cfg(test)]
mod tests {
    use super::has_uia_override;

    #[test]
    fn detects_only_explicit_ui_automation_overrides() {
        assert!(!has_uia_override(""));
        assert!(!has_uia_override("uiautomationcore2=d;d3d11=n"));
        assert!(has_uia_override("d3d11=n;UIAUTOMATIONCORE=d"));
        assert!(has_uia_override("d3d11,uiautomationcore=n,b"));
    }
}

/// Call before the Tauri builder runs. Returns normally when the runtime is
/// present or the game runs on real Windows (Tauri's dialog covers that case).
pub(crate) fn exit_if_missing_under_wine() {
    if tauri::webview_version().is_ok() || !running_under_wine() {
        return;
    }
    show_error(&format!(
        "Tiao could not find the Microsoft Edge WebView2 Runtime.\n\n\
         This is the Windows version running through Proton or Wine, which do not \
         include it.\n\n\
         Tiao has a native Linux version. In Steam, open the game's \
         Properties > Compatibility and turn off \"Force the use of a specific Steam \
         Play compatibility tool\".\n\n\
         To keep using Proton, install the WebView2 Runtime into the game's prefix: \
         download the Evergreen Standalone Installer (x64) from \
         https://developer.microsoft.com/microsoft-edge/webview2/ and run\n\n\
         protontricks-launch --appid {STEAM_APP_ID} MicrosoftEdgeWebView2RuntimeInstallerX64.exe"
    ));
    std::process::exit(1);
}

// Wine's ntdll exports wine_get_version; Microsoft's never does.
fn running_under_wine() -> bool {
    use windows_sys::Win32::System::LibraryLoader::{GetModuleHandleA, GetProcAddress};
    unsafe {
        let ntdll = GetModuleHandleA(c"ntdll.dll".as_ptr().cast());
        !ntdll.is_null() && GetProcAddress(ntdll, c"wine_get_version".as_ptr().cast()).is_some()
    }
}

fn show_error(message: &str) {
    use windows_sys::Win32::UI::WindowsAndMessaging::{MessageBoxW, MB_ICONERROR, MB_OK};
    let wide = |text: &str| text.encode_utf16().chain(Some(0)).collect::<Vec<u16>>();
    let text = wide(message);
    let caption = wide("Tiao");
    unsafe {
        MessageBoxW(
            std::ptr::null_mut(),
            text.as_ptr(),
            caption.as_ptr(),
            MB_OK | MB_ICONERROR,
        );
    }
}
