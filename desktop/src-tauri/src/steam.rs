//! Steamworks SDK 1.64 flat C ABI, loaded from the packaged, verified library.
//! Mirrors Mesozoic's explicit library loading and manual callback pump.
use crate::{config, events, steam_overlay};
use libloading::Library;
use serde_json::{json, Value};
use std::{
    collections::{BTreeSet, HashMap},
    ffi::{c_char, c_void, CStr, CString},
    path::PathBuf,
    sync::{mpsc, Mutex},
    time::{Duration, Instant},
};
use tauri::AppHandle;
type Ptr = *mut c_void;
type Reply = mpsc::Sender<Result<Vec<u8>, String>>;
struct Session {
    lib: Library,
    calls: HashMap<u64, (i32, Reply)>,
    tickets: HashMap<u32, Reply>,
    active_tickets: HashMap<u32, Instant>,
    opening: bool,
    pending: BTreeSet<String>,
    store_needed: bool,
    game: Option<String>,
    lobby: Option<u64>,
    lobby_version: u64,
    preparing: bool,
    join_version: u64,
    pending_join: Value,
}
static SESSION: Mutex<Option<Session>> = Mutex::new(None);
#[repr(C)]
struct Message {
    user: i32,
    callback: i32,
    data: *mut u8,
    size: i32,
}
macro_rules! api {($s:expr,$name:literal,($($arg:expr),*) : ($($ty:ty),*) -> $ret:ty) => {{
    // SAFETY: Symbols and signatures are pinned to the SDK 1.64 flat header.
    let function=unsafe{$s.lib.get::<unsafe extern "C" fn($($ty),*)->$ret>(concat!($name,"\0").as_bytes())}.map_err(|e|e.to_string())?;
    unsafe{function($($arg),*)}
}};}
impl Session {
    fn interface(&self, name: &[u8]) -> Result<Ptr, String> {
        let function = unsafe { self.lib.get::<unsafe extern "C" fn() -> Ptr>(name) }
            .map_err(|e| e.to_string())?;
        let value = unsafe { function() };
        if value.is_null() {
            Err("Steam interface unavailable".into())
        } else {
            Ok(value)
        }
    }
    fn user(&self) -> Result<Ptr, String> {
        self.interface(b"SteamAPI_SteamUser_v023\0")
    }
    fn friends(&self) -> Result<Ptr, String> {
        self.interface(b"SteamAPI_SteamFriends_v018\0")
    }
    fn stats(&self) -> Result<Ptr, String> {
        self.interface(b"SteamAPI_SteamUserStats_v013\0")
    }
    fn utils(&self) -> Result<Ptr, String> {
        self.interface(b"SteamAPI_SteamUtils_v010\0")
    }
    fn matchmaking(&self) -> Result<Ptr, String> {
        self.interface(b"SteamAPI_SteamMatchmaking_v009\0")
    }
    fn leave(&self, lobby: u64) -> Result<(), String> {
        api!(self,"SteamAPI_ISteamMatchmaking_LeaveLobby",(self.matchmaking()?,lobby):(Ptr,u64)->());
        Ok(())
    }
    fn set_game(&mut self, game: Option<String>) -> Result<(), String> {
        if self.game == game {
            return Ok(());
        }
        self.game = game;
        self.lobby_version = self.lobby_version.wrapping_add(1);
        if let Some(lobby) = self.lobby.take() {
            api!(self,"SteamAPI_ISteamMatchmaking_SetLobbyJoinable",(self.matchmaking()?,lobby,false):(Ptr,u64,bool)->bool);
            self.leave(lobby)?;
        }
        Ok(())
    }
    fn flush(&mut self) -> Result<(), String> {
        let stats = self.stats()?;
        let mut accepted = Vec::new();
        for name in &self.pending {
            let name_c = cstring(name)?;
            let mut achieved = false;
            let known = api!(self,"SteamAPI_ISteamUserStats_GetAchievement",(stats,name_c.as_ptr(),&mut achieved):(Ptr,*const c_char,*mut bool)->bool);
            if known
                && (achieved
                    || api!(self,"SteamAPI_ISteamUserStats_SetAchievement",(stats,name_c.as_ptr()):(Ptr,*const c_char)->bool))
            {
                accepted.push(name.clone());
                self.store_needed |= !achieved;
            }
        }
        for name in accepted {
            self.pending.remove(&name);
        }
        if self.store_needed && api!(self,"SteamAPI_ISteamUserStats_StoreStats",(stats):(Ptr)->bool)
        {
            self.store_needed = false;
        }
        Ok(())
    }
}
fn cstring(text: &str) -> Result<CString, String> {
    CString::new(text).map_err(|_| "Invalid Steam string".into())
}
fn string(ptr: *const c_char) -> String {
    if ptr.is_null() {
        String::new()
    } else {
        unsafe { CStr::from_ptr(ptr) }
            .to_string_lossy()
            .into_owned()
    }
}
fn number32(bytes: &[u8], offset: usize) -> Option<u32> {
    Some(u32::from_le_bytes(
        bytes.get(offset..offset + 4)?.try_into().ok()?,
    ))
}
fn number64(bytes: &[u8], offset: usize) -> Option<u64> {
    Some(u64::from_le_bytes(
        bytes.get(offset..offset + 8)?.try_into().ok()?,
    ))
}
fn packed64_offset() -> usize {
    if cfg!(windows) {
        8
    } else {
        4
    }
}
fn completed_lobby(callback: i32, bytes: &[u8]) -> Option<u64> {
    match callback {
        513 if number32(bytes, 0) == Some(1) => number64(bytes, packed64_offset()),
        504 if number32(bytes, 16) == Some(1) => number64(bytes, 0),
        _ => None,
    }
}
fn valid_name(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_')
}
fn valid_game(value: &str) -> bool {
    value.len() == 6
        && value
            .bytes()
            .all(|b| b.is_ascii_uppercase() || b.is_ascii_digit())
}
fn library_path() -> Result<PathBuf, String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let dir = exe.parent().ok_or("No executable directory")?;
    if cfg!(debug_assertions) {
        if let Ok(path) = std::env::var("TIAO_STEAM_LIBRARY") {
            return Ok(path.into());
        }
    }
    Ok(if cfg!(target_os = "macos") {
        dir.join("../Frameworks/libsteam_api.dylib")
    } else {
        dir.join(if cfg!(windows) {
            "steam_api64.dll"
        } else {
            "libsteam_api.so"
        })
    })
}
pub fn init() -> Result<(), String> {
    if !config::steam() {
        return Ok(());
    }
    let lib = unsafe { Library::new(library_path()?) }.map_err(|e| e.to_string())?;
    let session = Session {
        lib,
        calls: HashMap::new(),
        tickets: HashMap::new(),
        active_tickets: HashMap::new(),
        opening: false,
        pending: BTreeSet::new(),
        store_needed: false,
        game: None,
        lobby: None,
        lobby_version: 0,
        preparing: false,
        join_version: 0,
        pending_join: Value::Null,
    };
    let restart = api!(session,"SteamAPI_RestartAppIfNecessary",(config::app_id()):(u32)->bool);
    if restart {
        std::process::exit(0);
    }
    let mut error = [0 as c_char; 1024];
    if api!(session,"SteamAPI_InitFlat",(error.as_mut_ptr()):(*mut c_char)->i32) != 0 {
        return Err("Steam initialization failed".into());
    }
    let id = api!(session,"SteamAPI_ISteamUtils_GetAppID",(session.utils()? ):(Ptr)->u32);
    if id != config::app_id() {
        api!(session,"SteamAPI_Shutdown",():()->());
        return Err("Steam initialized for a different game".into());
    }
    api!(session,"SteamAPI_ManualDispatch_Init",():()->());
    *SESSION.lock().unwrap() = Some(session);
    Ok(())
}
pub fn active() -> bool {
    SESSION.lock().unwrap().is_some()
}
pub fn overlay_needs_present() -> bool {
    let Ok(lock) = SESSION.try_lock() else {
        return true;
    };
    let Some(s) = lock.as_ref() else {
        return false;
    };
    (|| -> Result<bool, String> {
        Ok(api!(s,"SteamAPI_ISteamUtils_BOverlayNeedsPresent",(s.utils()? ):(Ptr)->bool))
    })()
    .unwrap_or(false)
}
pub fn start_pump(app: &AppHandle) {
    if !active() {
        return;
    }
    let app = app.clone();
    std::thread::Builder::new()
        .name("steam-callbacks".into())
        .spawn(move || loop {
            std::thread::sleep(Duration::from_millis(33));
            let result = pump();
            let Ok(Some((activation, joins, purchases))) = result else {
                if !active() {
                    return;
                }
                continue;
            };
            if let Some(value) = activation {
                steam_overlay::on_activation(value);
            }
            for id in joins {
                join_lobby(app.clone(), id);
            }
            for purchase in purchases {
                events::send(&app, "steam:microTxnAuthorization", purchase);
            }
        })
        .expect("Steam callback thread");
}
type PumpEvents = (Option<bool>, Vec<u64>, Vec<Value>);
fn pump() -> Result<Option<PumpEvents>, String> {
    let mut lock = SESSION.lock().unwrap();
    let Some(s) = lock.as_mut() else {
        return Ok(None);
    };
    let pipe = api!(s,"SteamAPI_GetHSteamPipe",():()->i32);
    api!(s,"SteamAPI_ManualDispatch_RunFrame",(pipe):(i32)->());
    let mut message = Message {
        user: 0,
        callback: 0,
        data: std::ptr::null_mut(),
        size: 0,
    };
    let (mut activation, mut joins, mut purchases) = (None, Vec::new(), Vec::new());
    while api!(s,"SteamAPI_ManualDispatch_GetNextCallback",(pipe,&mut message):(i32,*mut Message)->bool)
    {
        if !message.data.is_null() && message.size > 0 && message.size <= 65536 {
            let data = unsafe { std::slice::from_raw_parts(message.data, message.size as usize) };
            match message.callback {
                331 => activation = data.first().map(|v| *v != 0),
                333 => {
                    if let Some(id) = number64(data, 0) {
                        joins.push(id);
                    }
                }
                152 => {
                    let offset = packed64_offset();
                    if let (Some(app_id), Some(order_id), Some(authorized)) = (
                        number32(data, 0),
                        number64(data, offset),
                        data.get(offset + 8),
                    ) {
                        if app_id == config::app_id() {
                            purchases.push(json!({"appId":app_id,"orderId":order_id.to_string(),"authorized":*authorized!=0}));
                        }
                    }
                }
                168 => {
                    if let Some(handle) = number32(data, 0) {
                        if let Some(reply) = s.tickets.remove(&handle) {
                            let _ = reply.send(Ok(data.to_vec()));
                        }
                    }
                }
                703 => {
                    if let (Some(id), Some(callback), Some(size)) =
                        (number64(data, 0), number32(data, 8), number32(data, 12))
                    {
                        if let Some((expected, reply)) = s.calls.remove(&id) {
                            let mut bytes = vec![0; size.min(65536) as usize];
                            let mut failed = false;
                            let success = size <= 65536
                                && callback as i32 == expected
                                && api!(s,"SteamAPI_ManualDispatch_GetAPICallResult",(pipe,id,bytes.as_mut_ptr().cast(),size as i32,expected,&mut failed):(i32,u64,Ptr,i32,i32,*mut bool)->bool);
                            let response = if success && !failed {
                                Ok(bytes)
                            } else {
                                Err("Steam request failed".into())
                            };
                            // A timed-out caller cannot leave a lobby created/joined later.
                            if let Err(error) = reply.send(response) {
                                if let Ok(bytes) = error.0 {
                                    if let Some(lobby) = completed_lobby(expected, &bytes) {
                                        let _ = s.leave(lobby);
                                    }
                                }
                            }
                        }
                    }
                }
                _ => (),
            }
        }
        api!(s,"SteamAPI_ManualDispatch_FreeLastCallback",(pipe):(i32)->());
    }
    let expired: Vec<_> = s
        .active_tickets
        .iter()
        .filter(|(_, time)| time.elapsed() > Duration::from_secs(120))
        .map(|(handle, _)| *handle)
        .collect();
    for handle in expired {
        s.active_tickets.remove(&handle);
        s.tickets.remove(&handle);
        api!(s,"SteamAPI_ISteamUser_CancelAuthTicket",(s.user()?,handle):(Ptr,u32)->());
    }
    s.flush()?;
    Ok(Some((activation, joins, purchases)))
}
async fn receive(receiver: mpsc::Receiver<Result<Vec<u8>, String>>) -> Result<Vec<u8>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        receiver
            .recv_timeout(Duration::from_secs(15))
            .map_err(|_| "Steam request timed out".to_string())?
    })
    .await
    .map_err(|e| e.to_string())?
}
pub async fn ticket(identity: &str) -> Result<Option<(u32, String)>, String> {
    let (handle, receiver) = {
        let mut lock = SESSION.lock().unwrap();
        let Some(s) = lock.as_mut() else {
            return Ok(None);
        };
        let identity = cstring(identity)?;
        let handle = api!(s,"SteamAPI_ISteamUser_GetAuthTicketForWebApi",(s.user()?,identity.as_ptr()):(Ptr,*const c_char)->u32);
        if handle == 0 {
            return Err("Steam refused ticket".into());
        }
        let (sender, receiver) = mpsc::channel();
        s.tickets.insert(handle, sender);
        s.active_tickets.insert(handle, Instant::now());
        (handle, receiver)
    };
    let result = receive(receiver).await.and_then(|data| {
        let len = number32(&data, 8).ok_or("Invalid Steam ticket")? as usize;
        if number32(&data, 4) != Some(1) || !(1..=2560).contains(&len) {
            return Err("Steam ticket failed".into());
        }
        Ok((
            handle,
            hex::encode(data.get(12..12 + len).ok_or("Truncated Steam ticket")?),
        ))
    });
    if result.is_err() {
        cancel_ticket(handle);
    }
    result.map(Some)
}
pub fn cancel_ticket(handle: u32) {
    let _ = (|| -> Result<(), String> {
        let mut lock = SESSION.lock().unwrap();
        if let Some(s) = lock.as_mut() {
            s.tickets.remove(&handle);
            s.active_tickets.remove(&handle);
            api!(s,"SteamAPI_ISteamUser_CancelAuthTicket",(s.user()?,handle):(Ptr,u32)->());
        }
        Ok(())
    })();
}
fn join_lobby(app: AppHandle, id: u64) {
    tauri::async_runtime::spawn(async move {
        let result=async{
        let (version,receiver)={let mut lock=SESSION.lock().unwrap();let s=lock.as_mut().ok_or("Steam unavailable")?;
            s.join_version+=1;let version=s.join_version;
            let call=api!(s,"SteamAPI_ISteamMatchmaking_JoinLobby",(s.matchmaking()?,id):(Ptr,u64)->u64);
            let(sender,receiver)=mpsc::channel();s.calls.insert(call,(504,sender));(version,receiver)};
        let data=receive(receiver).await?;
        let mut lock=SESSION.lock().unwrap();let s=lock.as_mut().ok_or("Steam unavailable")?;
        if number32(&data,16)!=Some(1){return Err("Could not enter invite lobby".into());}
        let ptr=api!(s,"SteamAPI_ISteamMatchmaking_GetLobbyData",(s.matchmaking()?,id,c"tiao_game_id".as_ptr()):(Ptr,u64,*const c_char)->*const c_char);
        let game=string(ptr);s.leave(id)?;
        if s.join_version==version{s.pending_join=json!({"id":version,"gameId":if valid_game(&game){Some(game)}else{None}});}
        Ok::<_,String>(())
    }.await;
        if let Err(error) = result {
            eprintln!("Steam invite failed: {error}");
            let mut lock = SESSION.lock().unwrap();
            if let Some(s) = lock.as_mut() {
                let _ = s.leave(id);
                s.pending_join = json!({"id":s.join_version,"gameId":null});
            }
        }
        events::send(&app, "steam:joinRequested", Value::Null);
    });
}
pub fn join_from_args(app: &AppHandle, args: Vec<String>) {
    if let Some(index) = args.iter().position(|s| s == "+connect_lobby") {
        if let Some(id) = args
            .get(index + 1)
            .filter(|s| !s.starts_with('0') && s.bytes().all(|b| b.is_ascii_digit()))
            .and_then(|s| s.parse::<u64>().ok())
            .filter(|id| *id > 0)
        {
            join_lobby(app.clone(), id);
        }
    }
}
async fn invite() -> Result<Value, String> {
    {
        let mut lock = SESSION.lock().unwrap();
        let Some(s) = lock.as_mut() else {
            return Ok(json!(false));
        };
        if s.opening {
            return Ok(json!(false));
        }
        s.opening = true;
    }
    let result = invite_inner().await;
    if let Some(s) = SESSION.lock().unwrap().as_mut() {
        s.opening = false;
    }
    result
}
fn prepare_lobby() {
    {
        let mut lock = SESSION.lock().unwrap();
        let Some(s) = lock.as_mut() else {
            return;
        };
        if s.preparing || s.lobby.is_some() || s.game.is_none() {
            return;
        }
        s.preparing = true;
    }
    tauri::async_runtime::spawn(async {
        loop {
            let attempt = (|| -> Result<_, String> {
                let mut lock = SESSION.lock().unwrap();
                let s = lock.as_mut().ok_or("Steam unavailable")?;
                let game = s.game.clone().ok_or("No waiting room")?;
                let call = api!(s,"SteamAPI_ISteamMatchmaking_CreateLobby",(s.matchmaking()?,0,2):(Ptr,i32,i32)->u64);
                let (sender, receiver) = mpsc::channel();
                s.calls.insert(call, (513, sender));
                Ok((s.lobby_version, game, receiver))
            })();
            let Ok((version, game, receiver)) = attempt else {
                if let Some(s) = SESSION.lock().unwrap().as_mut() {
                    s.preparing = false;
                }
                return;
            };
            let result = receive(receiver).await;
            let mut lock = SESSION.lock().unwrap();
            let Some(s) = lock.as_mut() else {
                return;
            };
            let result = (|| -> Result<(), String> {
                let data = result?;
                if number32(&data, 0) != Some(1) {
                    return Err("Could not prepare invite lobby".into());
                }
                let lobby = number64(&data, packed64_offset()).ok_or("Invalid lobby response")?;
                if s.lobby_version != version {
                    api!(s,"SteamAPI_ISteamMatchmaking_SetLobbyJoinable",(s.matchmaking()?,lobby,false):(Ptr,u64,bool)->bool);
                    return s.leave(lobby);
                }
                let game = cstring(&game)?;
                if !api!(s,"SteamAPI_ISteamMatchmaking_SetLobbyData",(s.matchmaking()?,lobby,c"tiao_game_id".as_ptr(),game.as_ptr()):(Ptr,u64,*const c_char,*const c_char)->bool)
                {
                    s.leave(lobby)?;
                    return Err("Lobby metadata refused".into());
                }
                s.lobby = Some(lobby);
                Ok(())
            })();
            if let Err(error) = result {
                eprintln!("Preparing Steam invite: {error}");
            }
            // Serialize room changes: an older create must finish and leave first.
            if s.lobby_version != version && s.game.is_some() {
                continue;
            }
            s.preparing = false;
            return;
        }
    });
}
async fn invite_inner() -> Result<Value, String> {
    let version = {
        let lock = SESSION.lock().unwrap();
        let Some(s) = lock.as_ref() else {
            return Ok(json!(false));
        };
        if s.game.is_none() {
            return Ok(json!(false));
        }
        s.lobby_version
    };
    prepare_lobby();
    for _ in 0..600 {
        {
            let lock = SESSION.lock().unwrap();
            let Some(s) = lock.as_ref() else {
                return Ok(json!(false));
            };
            if s.lobby_version != version {
                return Ok(json!(false));
            }
            if let Some(lobby) = s.lobby {
                api!(s,"SteamAPI_ISteamFriends_ActivateGameOverlayInviteDialog",(s.friends()?,lobby):(Ptr,u64)->());
                return Ok(json!(true));
            }
            if !s.preparing {
                return Ok(json!(false));
            }
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    Ok(json!(false))
}
pub async fn call(_app: &AppHandle, channel: &str, args: &[Value]) -> Result<Value, String> {
    if channel == "steam:openInviteDialog" {
        return invite().await;
    }
    if channel == "steam:getWebApiTicket" {
        let Some((handle, ticket)) = ticket("tiao-iap").await? else {
            return Ok(Value::Null);
        };
        // Keep the ticket valid for server verification, then expire it in the pump.
        let _ = handle;
        return Ok(json!(ticket));
    }
    let mut lock = SESSION.lock().unwrap();
    let Some(s) = lock.as_mut() else {
        return Ok(match channel {
            "steam:isActive" | "steam:openOverlay" | "steam:openOverlayUrl" => json!(false),
            "steam:getAchievementStates" => json!({}),
            "steam:unlockAchievement" | "steam:indicateAchievementProgress" => {
                json!({"ok":false,"reason":"unavailable"})
            }
            "steam:setStats" => json!({"ok":false,"written":0,"stored":false}),
            _ => Value::Null,
        });
    };
    let text = |i| args.get(i).and_then(Value::as_str).unwrap_or("");
    match channel {
        "steam:isActive" => Ok(json!(true)),
        "steam:getUser" => {
            let id = api!(s,"SteamAPI_ISteamUser_GetSteamID",(s.user()? ):(Ptr)->u64);
            let name = api!(s,"SteamAPI_ISteamFriends_GetPersonaName",(s.friends()? ):(Ptr)->*const c_char);
            let country =
                api!(s,"SteamAPI_ISteamUtils_GetIPCountry",(s.utils()? ):(Ptr)->*const c_char);
            Ok(
                json!({"steamId":id.to_string(),"displayName":string(name),"country":string(country)}),
            )
        }
        "steam:setInviteGame" => {
            s.set_game(valid_game(text(0)).then(|| text(0).into()))?;
            drop(lock);
            prepare_lobby();
            Ok(Value::Null)
        }
        "steam:getPendingJoin" => Ok(s.pending_join.clone()),
        "steam:acknowledgeJoin" => {
            if args.first() == s.pending_join.get("id") {
                s.pending_join = Value::Null;
            }
            Ok(Value::Null)
        }
        "steam:unlockAchievement" => {
            if !valid_name(text(0)) {
                return Err("Invalid achievement".into());
            }
            s.pending.insert(text(0).into());
            s.flush()?;
            Ok(json!({"ok":true}))
        }
        "steam:getAchievementStates" => {
            let names = args
                .first()
                .and_then(Value::as_array)
                .ok_or("Invalid achievements")?;
            if names.len() > 256 {
                return Err("Too many achievements".into());
            }
            let mut result = serde_json::Map::new();
            for name in names {
                let name = name.as_str().ok_or("Invalid name")?;
                if !valid_name(name) {
                    return Err("Invalid achievement".into());
                }
                let key = cstring(name)?;
                let mut achieved = false;
                if api!(s,"SteamAPI_ISteamUserStats_GetAchievement",(s.stats()?,key.as_ptr(),&mut achieved):(Ptr,*const c_char,*mut bool)->bool)
                {
                    result.insert(name.into(), json!(achieved));
                }
            }
            Ok(Value::Object(result))
        }
        "steam:indicateAchievementProgress" => {
            if !valid_name(text(0)) {
                return Err("Invalid achievement".into());
            }
            let key = cstring(text(0))?;
            let current = args
                .get(1)
                .and_then(Value::as_u64)
                .and_then(|v| u32::try_from(v).ok())
                .ok_or("Invalid progress")?;
            let max = args
                .get(2)
                .and_then(Value::as_u64)
                .and_then(|v| u32::try_from(v).ok())
                .filter(|v| *v > 0 && *v >= current)
                .ok_or("Invalid maximum")?;
            let ok = api!(s,"SteamAPI_ISteamUserStats_IndicateAchievementProgress",(s.stats()?,key.as_ptr(),current,max):(Ptr,*const c_char,u32,u32)->bool);
            Ok(json!({"ok":ok}))
        }
        "steam:setStats" => {
            let stats = args
                .first()
                .and_then(Value::as_object)
                .ok_or("Invalid stats")?;
            if stats.len() > 256 {
                return Err("Too many stats".into());
            }
            let mut written = 0;
            for (name, value) in stats {
                if !valid_name(name) {
                    return Err("Invalid stat name".into());
                }
                let value = value
                    .as_i64()
                    .and_then(|v| i32::try_from(v).ok())
                    .ok_or("Invalid stat value")?;
                let name = cstring(name)?;
                if api!(s,"SteamAPI_ISteamUserStats_SetStatInt32",(s.stats()?,name.as_ptr(),value):(Ptr,*const c_char,i32)->bool)
                {
                    written += 1;
                }
            }
            let stored = api!(s,"SteamAPI_ISteamUserStats_StoreStats",(s.stats()? ):(Ptr)->bool);
            Ok(json!({"ok":stored&&written==stats.len(),"written":written,"stored":stored}))
        }
        "steam:openOverlay" => {
            let name = text(0);
            if ![
                "Friends",
                "Community",
                "Players",
                "Settings",
                "OfficialGameGroup",
                "Stats",
                "Achievements",
            ]
            .contains(&name)
            {
                return Ok(json!(false));
            }
            let name = cstring(name)?;
            api!(s,"SteamAPI_ISteamFriends_ActivateGameOverlay",(s.friends()?,name.as_ptr()):(Ptr,*const c_char)->());
            Ok(json!(true))
        }
        "steam:openOverlayUrl" => {
            let url = text(0);
            if !config::external(url) || !url.starts_with("http") {
                return Ok(json!(false));
            }
            let url = cstring(url)?;
            api!(s,"SteamAPI_ISteamFriends_ActivateGameOverlayToWebPage",(s.friends()?,url.as_ptr(),0):(Ptr,*const c_char,i32)->());
            Ok(json!(true))
        }
        _ => Err("Unknown Steam command".into()),
    }
}
pub fn shutdown() {
    let mut lock = SESSION.lock().unwrap();
    if let Some(mut s) = lock.take() {
        let _ = s.set_game(None);
        let _ = s.flush();
        let _ = (|| -> Result<(), String> {
            api!(s,"SteamAPI_Shutdown",():()->());
            Ok(())
        })();
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn validates_steam_input() {
        assert!(valid_game("ABC123"));
        assert!(!valid_game("abc123"));
        assert!(!valid_game("../123"));
        assert!(valid_name("ACH_WIN_10"));
        assert!(!valid_name("x\0y"));
        assert!(!valid_name(&"A".repeat(129)));
    }
    #[test]
    fn late_lobby_results_are_safe_to_release_after_a_timeout() {
        let mut created = vec![0; 16];
        created[0..4].copy_from_slice(&1u32.to_le_bytes());
        let offset = packed64_offset();
        created[offset..offset + 8].copy_from_slice(&42u64.to_le_bytes());
        assert_eq!(completed_lobby(513, &created), Some(42));
        assert_eq!(completed_lobby(513, &created[..4]), None);
        let mut entered = vec![0; 20];
        entered[..8].copy_from_slice(&42u64.to_le_bytes());
        entered[16..20].copy_from_slice(&1u32.to_le_bytes());
        assert_eq!(completed_lobby(504, &entered), Some(42));
        assert_eq!(completed_lobby(152, &entered), None);
    }
    #[test]
    fn callback_bounds() {
        assert_eq!(number64(&[0; 7], 0), None);
        assert_eq!(number32(&[1, 0, 0, 0], 0), Some(1));
        assert_eq!(std::mem::size_of::<Message>(), 24);
    }
}
