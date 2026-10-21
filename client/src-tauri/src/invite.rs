//! `peekaview://share?room=<secret>&site=…&name=…&color=…&ice=<json>&relays=<json>` – lets an
//! integration (e.g. a video conference) open the desktop client prepared for its room. The user
//! still picks what to share.

use std::sync::Mutex;

use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager};

#[derive(Default)]
pub struct PendingInvite(pub Mutex<Option<Value>>);

pub fn handle(app: &AppHandle, url: &tauri::Url) {
    if url.scheme() != "peekaview" || url.host_str() != Some("share") {
        return;
    }
    let mut invite = json!({});
    for (key, value) in url.query_pairs() {
        match key.as_ref() {
            "site" | "room" | "name" | "color" => invite[key.as_ref()] = json!(value),
            // ready-made ICE servers (incl. short-lived TURN credentials) from an integration
            "ice" | "relays" => {
                if let Ok(v) = serde_json::from_str::<Value>(&value) {
                    invite[key.as_ref()] = v;
                }
            }
            _ => {}
        }
    }
    // a room is required; the viewer website must be http(s)
    if invite["room"].as_str().is_none_or(str::is_empty)
        || invite["site"].as_str().is_some_and(|s| !(s.starts_with("https://") || s.starts_with("http://")))
    {
        return;
    }
    *app.state::<PendingInvite>().0.lock().unwrap() = Some(invite.clone());
    let _ = app.emit_to("main", "invite", invite);
    if let Some(main) = app.get_webview_window("main") {
        crate::set_dock(app, true);
        let _ = main.unminimize();
        let _ = main.show();
        let _ = main.set_focus();
    }
}
