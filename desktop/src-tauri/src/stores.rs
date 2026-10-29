use crate::config;
use serde_json::{json, Value};
#[cfg(target_os = "macos")]
use std::{
    ffi::{c_char, c_void, CStr, CString},
    sync::{mpsc, OnceLock},
};
use tauri::{AppHandle, WebviewWindow};
#[cfg(target_os = "macos")]
static APP: OnceLock<AppHandle> = OnceLock::new();
#[cfg(target_os = "macos")]
extern "C" {
    fn tiao_store_install();
    fn tiao_store_call(
        json: *const c_char,
        context: *mut c_void,
        callback: extern "C" fn(*mut c_void, *const c_char),
    );
}
#[cfg(target_os = "macos")]
#[no_mangle]
extern "C" fn tiao_store_transactions(value: *const c_char) {
    if value.is_null() {
        return;
    }
    if let (Some(app), Ok(value)) = (
        APP.get(),
        serde_json::from_str::<Value>(&unsafe { CStr::from_ptr(value) }.to_string_lossy()),
    ) {
        crate::events::send(app, "iap:transactions", value);
    }
}
pub fn install(_app: &AppHandle) {
    #[cfg(target_os = "macos")]
    if config::CHANNEL == "mas" {
        let _ = APP.set(_app.clone());
        unsafe { tiao_store_install() };
    }
}
fn product(value: &str) -> bool {
    value.starts_with("com.ricoslabs.tiao.")
        && value.len() < 256
        && value
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b"._".contains(&b))
}
pub async fn call(
    _app: &AppHandle,
    _window: &WebviewWindow,
    channel: &str,
    args: &[Value],
) -> Result<Value, String> {
    if channel.starts_with("iap:") {
        if config::CHANNEL != "mas" || !cfg!(target_os = "macos") {
            return Ok(match channel {
                "iap:isAvailable" | "iap:finishTransaction" => json!(false),
                "iap:getProducts" | "iap:getPendingTransactions" => json!([]),
                "iap:purchase" => json!({"ok":false,"reason":"unavailable"}),
                _ => Value::Null,
            });
        }
        match channel {
            "iap:isAvailable" | "iap:restore" | "iap:getPendingTransactions" => (),
            "iap:getProducts" => {
                let ids = args
                    .first()
                    .and_then(Value::as_array)
                    .ok_or("Invalid products")?;
                if ids.len() > 128 || !ids.iter().all(|v| v.as_str().is_some_and(product)) {
                    return Err("Invalid products".into());
                }
            }
            "iap:purchase" => {
                if !args.first().and_then(Value::as_str).is_some_and(product)
                    || !args
                        .get(1)
                        .and_then(Value::as_str)
                        .is_some_and(|value| uuid::Uuid::parse_str(value).is_ok())
                {
                    return Err("Invalid purchase".into());
                }
            }
            "iap:finishTransaction" => {
                if !args
                    .first()
                    .and_then(Value::as_str)
                    .is_some_and(|v| !v.is_empty() && v.len() <= 256)
                {
                    return Err("Invalid transaction".into());
                }
            }
            _ => return Err("Unknown StoreKit command".into()),
        }
        #[cfg(target_os = "macos")]
        {
            extern "C" fn reply(context: *mut c_void, text: *const c_char) {
                // One callback consumes the sender allocated immediately below.
                let sender =
                    unsafe { Box::from_raw(context as *mut mpsc::Sender<Result<Value, String>>) };
                let result = serde_json::from_str::<Value>(
                    &unsafe { CStr::from_ptr(text) }.to_string_lossy(),
                )
                .map_err(|e| e.to_string())
                .and_then(|value| {
                    if let Some(error) = value["error"].as_str() {
                        Err(error.into())
                    } else {
                        Ok(value["result"].clone())
                    }
                });
                let _ = sender.send(result);
            }
            let input = CString::new(json!({"channel":channel,"args":args}).to_string()).unwrap();
            let (sender, receiver) = mpsc::channel::<Result<Value, String>>();
            unsafe {
                tiao_store_call(
                    input.as_ptr(),
                    Box::into_raw(Box::new(sender)).cast(),
                    reply,
                );
            }
            return tauri::async_runtime::spawn_blocking(move || {
                receiver.recv().map_err(|e| e.to_string())?
            })
            .await
            .map_err(|e| e.to_string())?;
        }
    }
    if channel.starts_with("msstore:") {
        match channel {
            "msstore:isAvailable" | "msstore:getAddOns" => (),
            "msstore:purchase" => {
                if !args
                    .first()
                    .and_then(Value::as_str)
                    .is_some_and(|v| !v.is_empty() && v.len() <= 256)
                {
                    return Err("Invalid offer token".into());
                }
            }
            "msstore:getCollectionsId" => {
                if args.len() != 2
                    || !args.iter().all(|v| {
                        v.as_str()
                            .is_some_and(|v| !v.is_empty() && v.len() <= 65536)
                    })
                {
                    return Err("Invalid collections request".into());
                }
            }
            _ => return Err("Unknown Microsoft Store command".into()),
        }
        if config::CHANNEL != "msstore" || !cfg!(windows) {
            return Ok(match channel {
                "msstore:isAvailable" => json!(false),
                "msstore:getAddOns" => json!([]),
                "msstore:purchase" => json!({"status":"unavailable"}),
                _ => Value::Null,
            });
        }
        #[cfg(windows)]
        {
            let channel = channel.to_string();
            let args = args.to_vec();
            let hwnd = _window.hwnd().map_err(|e| e.to_string())?.0 as usize;
            return tauri::async_runtime::spawn_blocking(move || {
                windows_store(&channel, &args, hwnd).map_err(|e| e.to_string())
            })
            .await
            .map_err(|e| e.to_string())?;
        }
    }
    Err("Unknown store command".into())
}

#[cfg(windows)]
fn windows_store(channel: &str, args: &[Value], hwnd: usize) -> windows::core::Result<Value> {
    use windows::{
        core::{Interface, HSTRING},
        Services::Store::{StoreContext, StorePurchaseStatus},
        Win32::{
            Foundation::HWND,
            System::Com::{CoInitializeEx, COINIT_MULTITHREADED},
            UI::Shell::IInitializeWithWindow,
        },
    };
    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
    }
    let ctx = StoreContext::GetDefault()?;
    let text = |i| HSTRING::from(args.get(i).and_then(Value::as_str).unwrap_or(""));
    match channel {
        "msstore:isAvailable" => Ok(json!(true)),
        "msstore:getAddOns" => {
            let kinds =
                windows_collections::IIterable::<HSTRING>::from(vec![HSTRING::from("Durable")]);
            let result = ctx.GetAssociatedStoreProductsAsync(&kinds)?.get()?;
            result.ExtendedError()?.ok()?;
            let mut products = Vec::new();
            for entry in result.Products()? {
                let p = entry.Value()?;
                products.push(json!({"storeId":p.StoreId()?.to_string(),"inAppOfferToken":p.InAppOfferToken()?.to_string(),"title":p.Title()?.to_string(),"formattedPrice":p.Price()?.FormattedPrice()?.to_string(),"isInUserCollection":p.IsInUserCollection()?}));
            }
            Ok(json!(products))
        }
        "msstore:purchase" => {
            let products = windows_store("msstore:getAddOns", &[], hwnd)?;
            let product = products
                .as_array()
                .and_then(|list| list.iter().find(|p| p["inAppOfferToken"] == args[0]));
            let Some(product) = product else {
                return Ok(json!({"status":"unknownProduct"}));
            };
            unsafe {
                ctx.cast::<IInitializeWithWindow>()?
                    .Initialize(HWND(hwnd as *mut std::ffi::c_void))?;
            }
            let result = ctx
                .RequestPurchaseAsync(&HSTRING::from(product["storeId"].as_str().unwrap_or("")))?
                .get()?;
            let status = match result.Status()? {
                StorePurchaseStatus::Succeeded => "succeeded",
                StorePurchaseStatus::AlreadyPurchased => "alreadyPurchased",
                StorePurchaseStatus::NotPurchased => "notPurchased",
                StorePurchaseStatus::NetworkError => "networkError",
                _ => "serverError",
            };
            Ok(json!({"status":status,"extendedError":format!("{:?}",result.ExtendedError()?)}))
        }
        "msstore:getCollectionsId" => Ok(json!(ctx
            .GetCustomerCollectionsIdAsync(&text(0), &text(1))?
            .get()?
            .to_string())),
        _ => Err(windows::core::Error::from_hresult(windows::core::HRESULT(
            0x80070057u32 as i32,
        ))),
    }
}
