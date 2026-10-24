//! Survives restarts that macOS forces after granting a permission ("Beenden & erneut öffnen"):
//! a running share is saved and continued in the same room on the next launch.

use serde_json::Value;
use std::io::Write;

static CHECKPOINT: std::sync::Mutex<()> = std::sync::Mutex::new(());
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
    let _lock = CHECKPOINT.lock().unwrap();
    state["at"] = now().into();
    if let Some(p) = path(app) {
        if let Err(error) = write_json(&p, &state) { crate::log(&format!("resume checkpoint: {error}")); }
    }
}

/// Updates one field of the saved state (e.g. the mode), if there is one.
pub fn update(app: &AppHandle, key: &str, value: Value) {
    let _lock = CHECKPOINT.lock().unwrap();
    let Some(p) = path(app) else { return };
    let Ok(mut state) = std::fs::read_to_string(&p).map(|s| serde_json::from_str::<Value>(&s).unwrap_or_default()) else { return };
    if state.is_object() {
        state[key] = value;
        if let Err(error) = write_json(&p, &state) { crate::log(&format!("resume checkpoint: {error}")); }
    }
}

/// Refreshes the timestamp while sharing, so a restart at any time resumes.
pub fn touch(app: &AppHandle) {
    update(app, "at", now().into());
}

pub fn load(app: &AppHandle) -> Option<Value> {
    let _lock = CHECKPOINT.lock().unwrap();
    let state: Value = serde_json::from_str(&std::fs::read_to_string(path(app)?).ok()?).ok()?;
    can_resume(state["at"].as_u64()?, now(), permission_flow(app).is_some()).then_some(state)
}

pub fn clear(app: &AppHandle) {
    let _lock = CHECKPOINT.lock().unwrap();
    if let Some(p) = path(app) {
        let _ = std::fs::remove_file(p);
    }
}

// A permission grant may take longer than the normal quick-restart window.
// Keep only UI context here; the existing share checkpoint owns the session data.
#[derive(serde::Serialize, serde::Deserialize)]
pub struct PermissionFlow {
    pub rooms: bool,
    #[serde(default)]
    pub invite: Option<Value>,
}

fn permission_path(app: &AppHandle) -> Option<std::path::PathBuf> {
    Some(path(app)?.with_file_name("permission-flow.json"))
}

pub fn permission_flow(app: &AppHandle) -> Option<PermissionFlow> {
    serde_json::from_slice(&std::fs::read(permission_path(app)?).ok()?).ok()
}

pub fn begin_permissions(app: &AppHandle) -> Result<(), String> {
    let _lock = CHECKPOINT.lock().unwrap();
    if permission_flow(app).is_some() { return Ok(()) }
    let flow = PermissionFlow {
        rooms: app.get_webview_window("rooms").is_some_and(|w| w.is_visible().unwrap_or(false)),
        invite: app.state::<crate::invite::PendingInvite>().0.lock().unwrap().clone(),
    };
    let path = permission_path(app).ok_or("Berechtigungsstatus konnte nicht gespeichert werden")?;
    write_json(&path, &serde_json::to_value(flow).map_err(|e| e.to_string())?).map_err(|e| e.to_string())
}

pub fn finish_permissions(app: &AppHandle) {
    if let Some(flow) = permission_flow(app) {
        if flow.rooms { crate::open_rooms_window(app); }
        if let Some(path) = permission_path(app) { let _ = std::fs::remove_file(path); }
    }
}

pub(crate) fn write_json(path: &std::path::Path, value: &Value) -> std::io::Result<()> {
    let mut nonce = [0u8; 8];
    getrandom::fill(&mut nonce).map_err(|e| std::io::Error::other(e.to_string()))?;
    let temporary = path.with_extension(format!("{:x}.tmp", u64::from_le_bytes(nonce)));
    let result = (|| {
        let mut options = std::fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)] {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options.open(&temporary)?;
        file.write_all(&serde_json::to_vec(value)?)?;
        file.sync_all()?;
        drop(file);
        std::fs::rename(&temporary, path)
    })();
    if result.is_err() { let _ = std::fs::remove_file(temporary); }
    result
}

fn can_resume(at: u64, now: u64, permission_pending: bool) -> bool {
    permission_pending || now.saturating_sub(at) <= MAX_AGE_SECS
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn permission_restart_retains_the_share_after_a_long_settings_visit() {
        assert!(can_resume(100, 1000, true));
        assert!(!can_resume(100, 1000, false));
        assert!(can_resume(100, 200, false));
    }
}
