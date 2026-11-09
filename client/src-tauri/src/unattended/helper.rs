//! The SYSTEM helper in the console session (`--helper`): waits in the links handed over to the
//! service and shows the bar on site while somebody is connected.

use std::time::Duration;

use serde_json::json;
use tauri::AppHandle;

use super::{log, store};

pub fn start(app: &AppHandle) {
    let links = store::get();
    crate::log(&format!("helper: {} links", links.rooms.len()));
    // the helper's own settings (in the SYSTEM profile): name and relays from the store; no voice,
    // no transcript, no arranging of windows
    crate::settings::set(
        app,
        &json!({ "name": links.name, "relays": links.relays, "voice_enabled": false, "transcript_enabled": false, "allow_resize": false }),
    );
    crate::p2p::lobby::sync(app, false);
    let app = app.clone();
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_millis(500));
        let names: Vec<String> = crate::session::peers()
            .as_array()
            .into_iter()
            .flatten()
            .filter(|p| p["host"] != true)
            .map(|p| p["name"].as_str().unwrap_or("Teilnehmer").to_string())
            .collect();
        let live = crate::session::running(&app).is_ok();
        #[cfg(target_os = "windows")]
        {
            super::indicator::set(if live { names } else { vec![] });
            if super::indicator::take_disconnect() && live {
                let link = crate::session::running(&app).ok().and_then(|s| s.remote.as_ref().map(|r| r.name.clone())).unwrap_or_default();
                log::event(&link, "–", "vor Ort getrennt");
                crate::session::stop(&app, Some("Vor Ort getrennt."), true);
            }
        }
        #[cfg(not(target_os = "windows"))]
        let _ = (names, live, log::clean(""));
    });
}
