//! Settings the Rust side needs outside the PeekaView window (tray menu, permanent rooms waiting for
//! remote access): name, relays, TURN, keep the link, allow resizing.
//! The PeekaView window and the settings window keep them in sync; stored in the app data folder (`settings.json`).

use std::sync::{
    atomic::{AtomicBool, Ordering},
    Mutex,
};

use serde_json::{json, Value};
use tauri::{AppHandle, Manager};

static SETTINGS: Mutex<Option<Value>> = Mutex::new(None);
/// Viewers may activate shared windows; control mode also permits resizing and arranging them.
static ALLOW_RESIZE: AtomicBool = AtomicBool::new(false);
static VOICE_ENABLED: AtomicBool = AtomicBool::new(true);

pub const VIEWER_SITE: &str = "https://peekaview.de";

const KEYS: [&str; 8] = ["name", "relays", "turn_urls", "turn_secret", "keep_link", "allow_resize", "voice_enabled", "transcript_enabled"];

fn file(app: &AppHandle) -> Option<std::path::PathBuf> {
    let dir = app.path().app_data_dir().ok()?;
    std::fs::create_dir_all(&dir).ok()?;
    Some(dir.join("settings.json"))
}

pub fn get(app: &AppHandle) -> Value {
    let mut s = SETTINGS.lock().unwrap();
    if s.is_none() {
        let loaded: Value = file(app).and_then(|f| std::fs::read(f).ok()).and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_else(|| json!({}));
        ALLOW_RESIZE.store(loaded["allow_resize"] == true, Ordering::Relaxed);
        VOICE_ENABLED.store(loaded["voice_enabled"] != false, Ordering::Relaxed);
        *s = Some(loaded);
    }
    s.clone().unwrap_or_else(|| json!({}))
}

/// Merges known keys into the settings.
pub fn set(app: &AppHandle, patch: &Value) -> Value {
    let mut current = get(app);
    for key in KEYS {
        if !patch[key].is_null() {
            current[key] = patch[key].clone();
        }
    }
    ALLOW_RESIZE.store(current["allow_resize"] == true, Ordering::Relaxed);
    VOICE_ENABLED.store(current["voice_enabled"] != false, Ordering::Relaxed);
    if let Some(f) = file(app) {
        let _ = std::fs::write(f, serde_json::to_vec_pretty(&current).unwrap_or_default());
    }
    *SETTINGS.lock().unwrap() = Some(current.clone());
    current
}

pub fn allow_resize() -> bool {
    ALLOW_RESIZE.load(Ordering::Relaxed)
}

pub fn voice_enabled() -> bool {
    VOICE_ENABLED.load(Ordering::Relaxed)
}

pub fn text(app: &AppHandle, key: &str) -> Option<String> {
    get(app)[key].as_str().map(str::to_string).filter(|s| !s.trim().is_empty())
}

pub fn lines(app: &AppHandle, key: &str) -> Vec<String> {
    match &get(app)[key] {
        Value::Array(a) => a.iter().filter_map(|v| v.as_str().map(str::to_string)).collect(),
        Value::String(s) => s.split_whitespace().map(str::to_string).collect(),
        _ => vec![],
    }
}
