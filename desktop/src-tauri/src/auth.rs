use crate::{config, events, steam};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    sync::Mutex,
    time::{Duration, Instant},
};
use tauri::{AppHandle, Manager};
use url::Url;

#[derive(Clone)]
struct Flow {
    created: Instant,
    verifier: Option<String>,
    link_steam: bool,
}
#[derive(Clone)]
struct Candidate {
    token: String,
    display_name: String,
    created: Instant,
}
#[derive(Default)]
pub struct Auth {
    token: Option<String>,
    loaded: bool,
    persistence: bool,
    generation: u64,
    flows: HashMap<String, Flow>,
    pending_link: Option<Candidate>,
}
fn entry() -> Result<keyring::Entry, String> {
    if config::steam() || std::env::var("TIAO_KEYCHAIN_ACCESS").as_deref() == Ok("deny") {
        return Err("Credential access disabled".into());
    }
    keyring::Entry::new("com.ricoslabs.tiao", "desktop-session").map_err(|e| e.to_string())
}
impl Auth {
    fn cancel(&mut self) -> Option<Candidate> {
        self.generation = self.generation.wrapping_add(1);
        self.flows.clear();
        self.pending_link.take()
    }
    fn consume(&mut self, state: &str) -> Option<(u64, Flow)> {
        self.flows
            .remove(state)
            .filter(|flow| flow.created.elapsed() <= Duration::from_secs(300))
            .map(|flow| (self.generation, flow))
    }
    fn load(&mut self) {
        if self.loaded {
            return;
        }
        self.loaded = true;
        self.persistence = config::steam();
        if let Ok(entry) = entry() {
            match entry.get_password() {
                Ok(token) => {
                    self.token = Some(token);
                    self.persistence = true;
                }
                Err(keyring::Error::NoEntry) => self.persistence = true,
                Err(error) => eprintln!("Session credential unavailable: {error}"),
            }
        }
    }
    fn save(&mut self, token: String) {
        if !config::steam() {
            self.persistence = entry()
                .and_then(|entry| entry.set_password(&token).map_err(|e| e.to_string()))
                .is_ok();
        }
        self.token = Some(token);
    }
    fn clear(&mut self) -> Result<(), String> {
        if !config::steam() && self.persistence {
            match entry()?.delete_credential() {
                Ok(()) | Err(keyring::Error::NoEntry) => (),
                Err(e) => return Err(e.to_string()),
            }
        }
        self.token = None;
        Ok(())
    }
    fn state(&mut self) -> String {
        self.flows
            .retain(|_, flow| flow.created.elapsed() <= Duration::from_secs(300));
        if self.flows.len() >= 128 {
            self.flows.clear();
        }
        let state = uuid::Uuid::new_v4().to_string();
        self.flows.insert(
            state.clone(),
            Flow {
                created: Instant::now(),
                verifier: None,
                link_steam: false,
            },
        );
        state
    }
}
pub fn client() -> reqwest::Client {
    reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(15))
        .build()
        .expect("HTTP client")
}
async fn post(path: &str, body: Value, token: Option<&str>) -> Result<reqwest::Response, String> {
    let mut request = client()
        .post(format!("{}{path}", config::api_url()))
        .json(&body);
    if let Some(token) = token {
        request = request.bearer_auth(token);
    }
    request
        .send()
        .await
        .map_err(|_| "Could not reach Tiao".into())
}
async fn payload(response: reqwest::Response) -> Result<Value, String> {
    let ok = response.status().is_success();
    let value: Value = response
        .json()
        .await
        .map_err(|_| "Invalid server response")?;
    if !ok {
        return Err(value["message"]
            .as_str()
            .unwrap_or("Authentication failed")
            .into());
    }
    Ok(value)
}
async fn revoke(token: &str) -> Result<(), String> {
    if !post(
        "/api/auth/desktop/logout",
        json!({"sessionToken": token}),
        None,
    )
    .await?
    .status()
    .is_success()
    {
        return Err("Could not revoke desktop session; retry logout when connected.".into());
    }
    Ok(())
}
async fn save(app: &AppHandle, generation: u64, value: &Value) -> Result<(), String> {
    let token = value["sessionToken"]
        .as_str()
        .ok_or("Missing session token")?
        .to_string();
    let accepted = {
        let state = app.state::<Mutex<Auth>>();
        let mut auth = state.lock().unwrap();
        if generation == auth.generation {
            auth.save(token.clone());
            true
        } else {
            false
        }
    };
    if !accepted {
        revoke(&token).await?;
        return Err("Sign-in cancelled".into());
    }
    Ok(())
}
fn challenge(verifier: &str) -> String {
    URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()))
}
async fn stage_link(app: &AppHandle, generation: u64, result: &Value) -> Result<(), String> {
    if !config::steam() {
        return Err("Open the Steam build to link a Steam account.".into());
    }
    let token = result["sessionToken"]
        .as_str()
        .ok_or("Missing session token")?
        .to_string();
    let response = client()
        .get(format!("{}/api/player/me", config::api_url()))
        .bearer_auth(&token)
        .send()
        .await
        .map_err(|_| "Could not verify the web account")?;
    let body = payload(response).await?;
    if body["player"]["kind"] != "account" {
        return Err("Could not verify the web account".into());
    }
    let display_name = body["player"]["displayName"]
        .as_str()
        .filter(|v| !v.is_empty())
        .ok_or("Missing account name")?
        .to_string();
    let candidate = Candidate {
        token: token.clone(),
        display_name,
        created: Instant::now(),
    };
    let name = candidate.display_name.clone();
    let (accepted, previous) = {
        let state = app.state::<Mutex<Auth>>();
        let mut auth = state.lock().unwrap();
        if auth.generation == generation {
            (true, auth.pending_link.replace(candidate))
        } else {
            (false, None)
        }
    };
    if !accepted {
        revoke(&token).await?;
        return Err("Sign-in cancelled".into());
    }
    if let Some(previous) = previous {
        let _ = revoke(&previous.token).await;
    }
    events::send(app, "auth:steamLinkReady", json!({"displayName":name}));
    Ok(())
}
async fn link_active(token: &str) -> Result<Value, String> {
    if !config::steam() {
        return Err("Open the Steam build to link a Steam account.".into());
    }
    let Some((handle, ticket)) = steam::ticket("tiao-auth").await? else {
        return Err("Steam is unavailable. Open Steam and try again.".into());
    };
    let response = post(
        "/api/auth/steam/session",
        json!({"action":"link","ticket":ticket,"appId":config::app_id()}),
        Some(token),
    )
    .await;
    steam::cancel_ticket(handle);
    payload(response?).await
}
fn poll(app: AppHandle, flow: String) {
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_millis(2500)).await;
            let pending = {
                let state = app.state::<Mutex<Auth>>();
                let auth = state.lock().unwrap();
                auth.flows.get(&flow).cloned()
            };
            let Some(pending) = pending else {
                return;
            };
            if pending.created.elapsed() > Duration::from_secs(300) {
                app.state::<Mutex<Auth>>()
                    .lock()
                    .unwrap()
                    .flows
                    .remove(&flow);
                events::send(&app, "auth:error", json!({"reason":"expired"}));
                return;
            }
            let Some(verifier) = pending.verifier else {
                return;
            };
            let Ok(response) = post(
                "/api/auth/desktop/poll",
                json!({"state":flow,"code_verifier":verifier}),
                None,
            )
            .await
            else {
                continue;
            };
            if !response.status().is_success() || response.status().as_u16() == 202 {
                continue;
            }
            let Ok(result) = response.json::<Value>().await else {
                continue;
            };
            let (kind, key, value) = if let Some(reason) = result["reason"].as_str() {
                ("error", "reason", reason)
            } else if let Some(code) = result["code"].as_str() {
                ("complete", "code", code)
            } else {
                continue;
            };
            let mut url = Url::parse(&format!("tiao://auth/{kind}")).unwrap();
            url.query_pairs_mut()
                .append_pair("state", &flow)
                .append_pair(key, value);
            deep_link(app.clone(), url.to_string()).await;
            return;
        }
    });
}
pub async fn call(app: &AppHandle, channel: &str, args: &[Value]) -> Result<Value, String> {
    let state = app.state::<Mutex<Auth>>();
    let (generation, token) = {
        let mut auth = state.lock().unwrap();
        auth.load();
        (auth.generation, auth.token.clone())
    };
    let text = |i| {
        args.get(i)
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string()
    };
    match channel {
        "auth:getToken" => Ok(json!(token)),
        "auth:getPersistenceStatus" => Ok(json!({"available": state.lock().unwrap().persistence})),
        "auth:cancelOAuth" => {
            let candidate = state.lock().unwrap().cancel();
            if let Some(candidate) = candidate {
                revoke(&candidate.token).await?;
            }
            Ok(Value::Null)
        }
        "auth:confirmSteamLink" => {
            let candidate = state
                .lock()
                .unwrap()
                .pending_link
                .clone()
                .filter(|candidate| candidate.created.elapsed() <= Duration::from_secs(300))
                .ok_or("Sign-in expired. Sign in to your web account again.")?;
            let linked = link_active(&candidate.token).await?;
            save(app, generation, &linked).await?;
            {
                let mut auth = state.lock().unwrap();
                if auth
                    .pending_link
                    .as_ref()
                    .is_some_and(|current| current.token == candidate.token)
                {
                    auth.pending_link = None;
                }
            }
            let _ = revoke(&candidate.token).await;
            events::send(app, "auth:complete", linked);
            Ok(Value::Null)
        }
        "auth:logout" => {
            let candidate = state.lock().unwrap().cancel();
            if let Some(candidate) = candidate {
                revoke(&candidate.token).await?;
            }
            if let Some(token) = token {
                revoke(&token).await?;
            }
            state.lock().unwrap().clear()?;
            Ok(json!({"ok":true}))
        }
        "auth:login" => {
            let (identifier, password) = (text(0), text(1));
            if identifier.len() > 320 || password.len() > 128 {
                return Err("Invalid login".into());
            }
            let response = post(
                "/api/player/login",
                json!({"identifier":identifier,"password":password}),
                None,
            )
            .await?;
            if !response.status().is_success() {
                return Err("Invalid credentials".into());
            }
            let bearer = response
                .headers()
                .get("set-auth-token")
                .and_then(|v| v.to_str().ok())
                .ok_or("Missing login token")?
                .to_string();
            let result =
                payload(post("/api/auth/desktop/session", json!({}), Some(&bearer)).await?).await?;
            if args.get(2).is_some_and(|value| value["linkSteam"] == true) {
                stage_link(app, generation, &result).await?;
                return Ok(json!({"pendingSteamLink":true}));
            }
            save(app, generation, &result).await?;
            Ok(Value::Null)
        }
        "auth:startOAuth" | "auth:linkOAuth" => {
            let provider = text(0);
            if !["google", "github", "discord", "apple", "steam"].contains(&provider.as_str()) {
                return Ok(json!({"ok":false,"reason":"bad_provider"}));
            }
            let mut verifier = None;
            let flow = {
                let mut auth = state.lock().unwrap();
                if channel == "auth:startOAuth" {
                    auth.flows.clear();
                }
                let flow = auth.state();
                if channel == "auth:startOAuth" {
                    let secret = format!(
                        "{}{}{}",
                        uuid::Uuid::new_v4().simple(),
                        uuid::Uuid::new_v4().simple(),
                        uuid::Uuid::new_v4().simple()
                    );
                    let pending = auth.flows.get_mut(&flow).unwrap();
                    pending.verifier = Some(secret.clone());
                    pending.link_steam =
                        args.get(1).is_some_and(|value| value["linkSteam"] == true);
                    verifier = Some(secret);
                }
                flow
            };
            let target = if channel == "auth:linkOAuth" {
                let token = token.ok_or("Not authenticated")?;
                let result = payload(
                    post(
                        "/api/auth/desktop/link/start",
                        json!({"provider":provider,"state":flow}),
                        Some(&token),
                    )
                    .await?,
                )
                .await?;
                let base = Url::parse(&config::api_url()).unwrap();
                let target = base
                    .join(result["path"].as_str().ok_or("Invalid link URL")?)
                    .map_err(|e| e.to_string())?;
                if target.origin() != base.origin()
                    || target.path() != "/api/auth/desktop/link/begin"
                {
                    return Err("Invalid link URL".into());
                }
                target
            } else {
                let mut target =
                    Url::parse(&format!("{}/api/auth/desktop/start", config::api_url())).unwrap();
                target
                    .query_pairs_mut()
                    .append_pair("provider", &provider)
                    .append_pair("state", &flow);
                if let Some(verifier) = &verifier {
                    target
                        .query_pairs_mut()
                        .append_pair("code_challenge", &challenge(verifier))
                        .append_pair("code_challenge_method", "S256");
                }
                target
            };
            if generation != state.lock().unwrap().generation {
                return Err("Sign-in cancelled".into());
            }
            if !config::external(target.as_str()) {
                return Err("Invalid OAuth URL".into());
            }
            if let Err(error) = open::that(target.as_str()) {
                state.lock().unwrap().flows.remove(&flow);
                return Err(error.to_string());
            }
            if verifier.is_some() {
                poll(app.clone(), flow);
            }
            Ok(json!({"ok":true}))
        }
        "auth:steam" => {
            if !config::steam() {
                return Ok(json!({"status":"unavailable"}));
            }
            let input = args.first().cloned().unwrap_or(Value::Null);
            let action = input["action"].as_str().unwrap_or("");
            if !["check", "create", "link"].contains(&action) {
                return Err("Invalid Steam action".into());
            }
            let Some((handle, ticket)) = steam::ticket("tiao-auth").await? else {
                return Ok(json!({"status":"unavailable"}));
            };
            let response = post("/api/auth/steam/session", json!({"action":action,"username":input["username"],"ticket":ticket,"appId":config::app_id()}), if action == "link" {token.as_deref()} else {None}).await;
            steam::cancel_ticket(handle);
            let result = payload(response?).await?;
            if result["status"] == "signed_in" {
                save(app, generation, &result).await?;
            }
            if result["status"] == "needs_setup" {
                let mut auth = state.lock().unwrap();
                if generation == auth.generation {
                    auth.clear()?;
                }
            }
            Ok(json!({"status":result["status"], "profile":result["profile"]}))
        }
        _ => Err("Unknown authentication command".into()),
    }
}
pub async fn deep_link(app: AppHandle, raw: String) {
    let Ok(url) = Url::parse(&raw) else {
        return;
    };
    if url.scheme() != "tiao"
        || !url.username().is_empty()
        || url.password().is_some()
        || url.port().is_some()
    {
        return;
    }
    let kind = if url.host_str() == Some("auth") {
        format!("auth{}", url.path())
    } else if url.host_str().is_none() {
        url.path().trim_start_matches('/').into()
    } else {
        return;
    };
    if !["auth/complete", "auth/error"].contains(&kind.as_str()) {
        return;
    }
    let params: HashMap<_, _> = url.query_pairs().into_owned().collect();
    let flow = params.get("state").cloned().unwrap_or_default();
    let (generation, pending) = {
        let state = app.state::<Mutex<Auth>>();
        let mut auth = state.lock().unwrap();
        let Some(pending) = auth.consume(&flow) else {
            return;
        };
        pending
    };
    if kind == "auth/error" {
        events::send(&app, "auth:error", json!({"reason":params.get("reason")}));
        return;
    }
    let Some(code) = params.get("code").filter(|code| !code.is_empty()) else {
        events::send(&app, "auth:error", json!({"reason":"malformed_callback"}));
        return;
    };
    let result = async {
        let mut body = json!({"state":flow,"code":code});
        if let Some(verifier) = pending.verifier {
            body["code_verifier"] = json!(verifier);
        }
        let result = payload(post("/api/auth/desktop/exchange", body, None).await?).await?;
        if pending.link_steam {
            stage_link(&app, generation, &result).await?;
        } else {
            save(&app, generation, &result).await?;
            events::send(&app, "auth:complete", result);
        }
        Ok::<_, String>(())
    }
    .await;
    if result.is_err() {
        events::send(&app, "auth:error", json!({"reason":"exchange_failed"}));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn callback_and_polling_can_consume_a_flow_only_once() {
        let mut auth = Auth::default();
        let state = auth.state();
        assert!(auth.consume("unrequested").is_none());
        let (generation, _) = auth.consume(&state).unwrap();
        assert_eq!(generation, 0);
        assert!(auth.consume(&state).is_none());
    }
    #[test]
    fn cancellation_invalidates_callbacks_and_returns_staged_proof_for_revocation() {
        let mut auth = Auth::default();
        let state = auth.state();
        auth.pending_link = Some(Candidate {
            token: "fake web proof".into(),
            display_name: "Player".into(),
            created: Instant::now(),
        });
        let (generation, _) = auth.consume(&state).unwrap();
        let next_state = auth.state();
        assert_eq!(auth.cancel().unwrap().token, "fake web proof");
        assert_ne!(auth.generation, generation);
        assert!(auth.consume(&next_state).is_none());
        assert!(auth.pending_link.is_none());
    }
    #[test]
    fn pkce_uses_the_standard_s256_base64url_challenge() {
        assert_eq!(
            challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
        );
    }
    #[test]
    fn oauth_states_are_unique_bounded_and_expire() {
        let mut auth = Auth::default();
        let first = auth.state();
        let second = auth.state();
        assert_ne!(first, second);
        auth.flows.insert(
            "expired".into(),
            Flow {
                created: Instant::now() - Duration::from_secs(301),
                verifier: None,
                link_steam: false,
            },
        );
        assert!(auth.consume("expired").is_none());
        auth.state();
        assert!(!auth.flows.contains_key("expired"));
        for _ in 0..300 {
            auth.state();
        }
        assert!(auth.flows.len() <= 128);
    }
    #[test]
    fn external_oauth_urls_reject_credentials_and_non_browser_protocols() {
        assert!(config::external(
            "https://api.playtiao.com/api/auth/desktop/start"
        ));
        for value in [
            "javascript:alert(1)",
            "file:///etc/passwd",
            "https://user:password@api.playtiao.com/",
        ] {
            assert!(!config::external(value));
        }
    }
}
