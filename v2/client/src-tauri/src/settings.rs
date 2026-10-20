//! Settings the Rust side needs without the toolbar (tray menu, permanent rooms waiting for
//! remote access): viewer site, name, relays, TURN, keep the link, allow resizing.
//! The toolbar keeps them in sync; stored in the app data folder (`settings.json`).

use std::sync::{
    atomic::{AtomicBool, Ordering},
    Mutex,
};

use serde_json::{json, Value};
use tauri::{AppHandle, Manager};

static SETTINGS: Mutex<Option<Value>> = Mutex::new(None);
/// viewers may resize shared windows on the presenter's screen (control mode)
static ALLOW_RESIZE: AtomicBool = AtomicBool::new(false);

const KEYS: [&str; 7] = ["site", "name", "relays", "turn_urls", "turn_secret", "keep_link", "allow_resize"];

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
    if let Some(f) = file(app) {
        let _ = std::fs::write(f, serde_json::to_vec_pretty(&current).unwrap_or_default());
    }
    *SETTINGS.lock().unwrap() = Some(current.clone());
    current
}

pub fn allow_resize() -> bool {
    ALLOW_RESIZE.load(Ordering::Relaxed)
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
