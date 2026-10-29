use serde_json::{json, Value};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};
#[derive(Default)]
pub struct Events {
    pub ready: bool,
    pub pending: Vec<Value>,
}
pub fn send(app: &AppHandle, channel: &str, payload: Value) {
    let event = json!({"channel":channel,"payload":payload});
    let state = app.state::<Mutex<Events>>();
    let mut events = state.lock().unwrap();
    if events.ready {
        let _ = app.emit_to("main", "desktop:event", event);
    } else {
        if events.pending.len() == 128 {
            events.pending.remove(0);
        }
        events.pending.push(event);
    }
}
