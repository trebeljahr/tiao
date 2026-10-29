use serde_json::{json, Value};
use url::Url;

pub const CHANNEL: &str = match option_env!("TIAO_DISTRIBUTION_CHANNEL") {
    Some(channel) => channel,
    None => "direct",
};
pub fn steam() -> bool {
    matches!(CHANNEL, "steam" | "steam-demo")
}
pub fn app_id() -> u32 {
    if CHANNEL == "steam-demo" {
        5491870
    } else {
        5035580
    }
}
pub fn api_url() -> String {
    let value = std::env::var("TIAO_API_URL").unwrap_or_else(|_| "https://api.playtiao.com".into());
    let url = Url::parse(&value).expect("Invalid TIAO_API_URL");
    assert!(
        url.username().is_empty()
            && url.password().is_none()
            && url.query().is_none()
            && url.fragment().is_none()
    );
    assert!(
        url.scheme() == "https"
            || (cfg!(debug_assertions)
                && url.scheme() == "http"
                && matches!(url.host_str(), Some("localhost" | "127.0.0.1")))
    );
    value.trim_end_matches('/').to_string()
}
pub fn renderer() -> Value {
    json!({"apiUrl": api_url(), "isSteamBuild": steam(), "isSteamDemo": CHANNEL == "steam-demo",
      "distributionChannel": if CHANNEL == "steam-demo" {"steam"} else {CHANNEL},
      "platform": match std::env::consts::OS { "macos" => "darwin", "windows" => "win32", other => other },
      "version": env!("CARGO_PKG_VERSION")})
}
pub fn external(value: &str) -> bool {
    Url::parse(value).is_ok_and(|url| {
        url.username().is_empty()
            && url.password().is_none()
            && matches!(url.scheme(), "https" | "http" | "mailto")
    })
}
