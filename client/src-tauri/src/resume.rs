//! Survives restarts that macOS forces after granting a permission ("Beenden & erneut öffnen"):
//! a running share is saved and continued in the same room on the next launch.

use serde_json::Value;
use tauri::{AppHandle, Manager};

/// Only a quick restart resumes; an app opened much later starts fresh.
const MAX_AGE_SECS: u64 = 180;

fn path(app: &AppHandle) -> Option<std::path::PathBuf> {
    let dir = app.path().app_data_dir().ok()?;
    std::fs::create_dir_all(&dir).ok()?;
    Some(dir.join("resume.json"))
}

fn now() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

pub fn save(app: &AppHandle, mut state: Value) {
    state["at"] = now().into();
    if let Some(p) = path(app) {
        let _ = std::fs::write(p, state.to_string());
    }
}

/// Updates one field of the saved state (e.g. the mode), if there is one.
pub fn update(app: &AppHandle, key: &str, value: Value) {
    let Some(p) = path(app) else { return };
    let Ok(mut state) = std::fs::read_to_string(&p).map(|s| serde_json::from_str::<Value>(&s).unwrap_or_default()) else { return };
    if state.is_object() {
        state[key] = value;
        let _ = std::fs::write(p, state.to_string());
    }
}

/// Refreshes the timestamp while sharing, so a restart at any time resumes.
pub fn touch(app: &AppHandle) {
    update(app, "at", now().into());
}

pub fn load(app: &AppHandle) -> Option<Value> {
    let state: Value = serde_json::from_str(&std::fs::read_to_string(path(app)?).ok()?).ok()?;
    (now().saturating_sub(state["at"].as_u64()?) <= MAX_AGE_SECS).then_some(state)
}

pub fn clear(app: &AppHandle) {
    if let Some(p) = path(app) {
        let _ = std::fs::remove_file(p);
    }
}
