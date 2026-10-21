//! Watching inside PeekaView: `peekaview://join?room=<secret.key>&name=…&who=…` – sent by the
//! viewer website when PeekaView is installed – opens the bundled viewer in a window of its own.
//! The rooms watched last are kept for the tray menu ("Letzte Verbindungen").
//!
//! The viewer windows show what remote people send (names, clipboard, pictures): they get no IPC
//! access (see capabilities/default.json) – the room travels in an initialization script.

use std::{path::PathBuf, sync::Mutex};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

const MAX: usize = 10;

#[derive(Clone, Serialize, Deserialize)]
pub struct Recent {
    pub room: String,
    /// the room's name and its presenter (user@computer), as the website knew them
    pub name: Option<String>,
    pub who: Option<String>,
    /// last opened (ms since 1970)
    pub last: u64,
}

impl Recent {
    pub fn label(&self) -> String {
        let room = self.name.clone().unwrap_or_else(|| format!("Raum {}…", &self.room[..self.room.len().min(6)]));
        match &self.who {
            Some(who) => format!("{room} – {who}"),
            None => room,
        }
    }
}

static RECENT: Mutex<Option<Vec<Recent>>> = Mutex::new(None);

fn file(app: &AppHandle) -> Option<PathBuf> {
    let dir = app.path().app_data_dir().ok()?;
    std::fs::create_dir_all(&dir).ok()?;
    Some(dir.join("recent.json"))
}

pub fn recent(app: &AppHandle) -> Vec<Recent> {
    let mut list = RECENT.lock().unwrap();
    if list.is_none() {
        *list = Some(file(app).and_then(|f| std::fs::read(f).ok()).and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default());
    }
    list.clone().unwrap_or_default()
}

fn remember(app: &AppHandle, entry: Recent) {
    let mut list = recent(app);
    let before = list.iter().find(|r| r.room == entry.room).cloned();
    list.retain(|r| r.room != entry.room);
    // names unknown this time: keep the ones from before
    let entry = Recent {
        name: entry.name.or(before.as_ref().and_then(|b| b.name.clone())),
        who: entry.who.or(before.and_then(|b| b.who)),
        ..entry
    };
    list.insert(0, entry);
    list.truncate(MAX);
    if let Some(f) = file(app) {
        let _ = std::fs::write(f, serde_json::to_vec_pretty(&list).unwrap_or_default());
    }
    *RECENT.lock().unwrap() = Some(list);
    crate::tray::refresh(app);
}

/// A room as in viewer links: `<secret>.<presenter key>` (base64url).
fn valid(room: &str) -> bool {
    !room.is_empty() && room.len() <= 200 && room.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
}

/// `peekaview://join?…` – returns whether the URL was one.
pub fn handle(app: &AppHandle, url: &tauri::Url) -> bool {
    if url.scheme() != "peekaview" || url.host_str() != Some("join") {
        return false;
    }
    let get = |key: &str| url.query_pairs().find(|(k, _)| k == key).map(|(_, v)| v.chars().take(80).collect::<String>()).filter(|v| !v.is_empty());
    if let Some(room) = get("room").filter(|r| valid(r)) {
        // not inside the deep link callback: building a window there deadlocks
        let (app, name, who) = (app.clone(), get("name"), get("who"));
        tauri::async_runtime::spawn(async move { open(&app, &room, name, who) });
    }
    true
}

/// Opens (or brings up) the viewer window for a room.
pub fn open(app: &AppHandle, room: &str, name: Option<String>, who: Option<String>) {
    if !valid(room) {
        return;
    }
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0);
    remember(app, Recent { room: room.to_string(), name, who, last: now });
    // one window per room
    let hash = room.bytes().fold(0xcbf29ce484222325u64, |h, b| (h ^ b as u64).wrapping_mul(0x100000001b3));
    let label = format!("viewer-{hash:016x}");
    if let Some(window) = app.get_webview_window(&label) {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
        return;
    }
    let title = recent(app).first().map(|r| format!("{} – PeekaView", r.label())).unwrap_or_else(|| "PeekaView".into());
    #[allow(unused_mut)]
    let mut script = format!("window.__PV_JOIN__ = {};", serde_json::to_string(room).unwrap_or_default());
    // development only: PEEKAVIEW_DEV_STATS=1 opens the statistics (Alt+Shift+S) right away
    #[cfg(debug_assertions)]
    if std::env::var("PEEKAVIEW_DEV_STATS").is_ok() {
        script.push_str("window.__PV_STATS__ = true;");
    }
    if let Err(e) = WebviewWindowBuilder::new(app, label, WebviewUrl::App("index.html".into()))
        .title(title)
        .inner_size(1280.0, 800.0)
        .min_inner_size(640.0, 420.0)
        .theme(Some(tauri::Theme::Dark))
        .initialization_script(&script)
        .build()
    {
        crate::log(&format!("viewer window: {e}"));
    }
}
