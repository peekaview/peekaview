//! Access without sign-in (Windows): a service (LocalSystem) keeps a helper running in the active
//! console session. The helper is this same program started with `--helper`: it waits in the
//! permanent links marked "Auch ohne Anmeldung", captures the whole desktop with DXGI Desktop
//! Duplication and injects input as SYSTEM, so the sign-in screen, the lock screen and UAC prompts
//! can be used from afar. Strg+Alt+Entf goes through the service (SendSAS).
//!
//! Roles of the executable, picked from the command line before Tauri starts:
//! * (none) – the normal app of the signed-in user
//! * `--service` – run by the service control manager
//! * `--helper` – started by the service in the console session
//! * `--install-service <app data dir>` / `--uninstall-service` – the elevated (UAC) setup step

pub mod desk;
pub mod helper;
pub mod log;
pub mod protocol;
pub mod special;
pub mod store;

#[cfg(target_os = "windows")]
pub mod client;
#[cfg(target_os = "windows")]
pub mod indicator;
#[cfg(target_os = "windows")]
pub mod install;
#[cfg(target_os = "windows")]
pub mod service;

use std::{path::PathBuf, sync::OnceLock};

use serde_json::{json, Value};
use tauri::{AppHandle, Manager};

#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
pub const SERVICE_NAME: &str = "PeekaViewService";
#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
pub const SERVICE_DISPLAY: &str = "PeekaView Fernzugriff";
#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
pub const PIPE: &str = r"\\.\pipe\peekaview-service";
pub const VERSION: &str = env!("CARGO_PKG_VERSION");

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Role {
    App,
    Service,
    Helper,
    Install(PathBuf),
    Uninstall,
}

/// The role from the command line (`args` without the program name). Only exact flags count –
/// a deep link or file argument never switches the role.
pub fn role_from_args(args: &[String]) -> Role {
    match args {
        [flag] if flag == "--service" => Role::Service,
        [flag] if flag == "--helper" => Role::Helper,
        [flag] if flag == "--uninstall-service" => Role::Uninstall,
        [flag, dir] if flag == "--install-service" && !dir.is_empty() => Role::Install(PathBuf::from(dir)),
        _ => Role::App,
    }
}

static ROLE: OnceLock<Role> = OnceLock::new();

pub fn set_role(role: Role) {
    let _ = ROLE.set(role);
}

fn role() -> &'static Role {
    ROLE.get().unwrap_or(&Role::App)
}

/// Running as the SYSTEM helper in the console session.
pub fn helper() -> bool {
    *role() == Role::Helper
}

/// A role that writes to `%ProgramData%\PeekaView`.
pub fn privileged() -> bool {
    !matches!(role(), Role::App)
}

/// `%ProgramData%\PeekaView` – only SYSTEM and administrators may write there.
pub fn data_dir() -> PathBuf {
    #[cfg(target_os = "windows")]
    return PathBuf::from(std::env::var("ProgramData").unwrap_or_else(|_| r"C:\ProgramData".into())).join("PeekaView");
    #[cfg(not(target_os = "windows"))]
    std::env::temp_dir().join("peekaview-unattended")
}

/// Runs a non-app role to its end; returns the process exit code. `None` for the app.
pub fn run_role(role: &Role) -> Option<i32> {
    #[cfg(target_os = "windows")]
    {
        let result = match role {
            Role::Service => service::run(),
            Role::Install(dir) => install::install(dir),
            Role::Uninstall => install::uninstall(),
            Role::App | Role::Helper => return None,
        };
        Some(match result {
            Ok(()) => 0,
            Err(e) => {
                crate::log(&format!("{role:?}: {e}"));
                1
            }
        })
    }
    #[cfg(not(target_os = "windows"))]
    {
        match role {
            Role::App | Role::Helper => None,
            _ => Some(2),
        }
    }
}

/// Pause before the service starts its helper again after `failures` failed starts or crashes.
pub fn backoff(failures: u32) -> std::time::Duration {
    std::time::Duration::from_secs(if failures == 0 { 0 } else { (1u64 << failures.min(6)).min(60) })
}

// ------------------------------------------------------------------ the user's app

/// State of the service for the link settings.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Status {
    pub installed: bool,
    pub running: bool,
    pub version: Option<String>,
}

pub fn status() -> Status {
    #[cfg(target_os = "windows")]
    return client::status();
    #[cfg(not(target_os = "windows"))]
    Status::default()
}

/// Does the running service take care of the link (then the app does not wait in it as well)?
pub fn served_by_service(room: &crate::rooms::Room) -> bool {
    room.unattended && cfg!(target_os = "windows") && !helper() && status().running
}

#[tauri::command]
pub async fn unattended_status() -> Value {
    let s = tauri::async_runtime::spawn_blocking(status).await.unwrap_or_default();
    json!({
        "available": cfg!(target_os = "windows"),
        "installed": s.installed,
        "running": s.running,
        "version": s.version,
        "outdated": s.version.as_deref().is_some_and(|v| v != VERSION),
    })
}

/// Switches "Auch ohne Anmeldung" for a link: the flag goes into rooms.json, then the elevated
/// setup step (UAC) hands the links over to the service – or removes it when none is left.
#[tauri::command]
pub async fn unattended_set(app: AppHandle, id: String, on: bool) -> Result<(), String> {
    if !cfg!(target_os = "windows") {
        return Err("Zugriff ohne Anmeldung gibt es bisher nur unter Windows.".into());
    }
    let room = crate::rooms::get(&app, &id).ok_or("Link nicht gefunden.")?;
    if on && (!room.remote || room.pin.is_none()) {
        return Err("Braucht Fernzugriff und eine PIN.".into());
    }
    let before = room.unattended;
    crate::rooms::set_unattended(&app, &id, on)?;
    let any = crate::rooms::all(&app).iter().any(|r| r.unattended && r.remote && r.pin.is_some());
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let result = tauri::async_runtime::spawn_blocking(move || setup(any, &dir)).await.map_err(|e| e.to_string())?;
    if let Err(e) = result {
        let _ = crate::rooms::set_unattended(&app, &id, before);
        return Err(e);
    }
    crate::p2p::lobby::sync(&app, true);
    let _ = tauri::Emitter::emit(&app, "rooms", crate::rooms::all(&app).iter().map(|r| r.view()).collect::<Vec<_>>());
    Ok(())
}

/// After a link changed in the app (PIN, renewed, deleted, remote access off): if that changes
/// what the service serves, hand the links over again (UAC prompt) – the service must never keep
/// serving a link that was switched off.
pub fn links_changed(app: &AppHandle, before: &[crate::rooms::Room]) {
    if !cfg!(target_os = "windows") || helper() {
        return;
    }
    let after = crate::rooms::all(app);
    if same_links(before, &after) {
        return;
    }
    let any = !store::sanitize("", &[], after).rooms.is_empty();
    let Ok(dir) = app.path().app_data_dir() else { return };
    std::thread::spawn(move || {
        if status().installed {
            if let Err(e) = setup(any, &dir) {
                crate::log(&format!("unattended: links not handed over – {e}"));
            }
        }
    });
}

/// Would the service serve the same links (same secrets, keys, PINs)?
fn same_links(a: &[crate::rooms::Room], b: &[crate::rooms::Room]) -> bool {
    let served = |rooms: &[crate::rooms::Room]| -> Vec<String> {
        store::sanitize("", &[], rooms.to_vec()).rooms.iter().map(|r| serde_json::to_string(r).unwrap_or_default()).collect()
    };
    served(a) == served(b)
}

/// The elevated step: install / update the service with the links, or remove it.
#[allow(unused_variables)]
fn setup(any: bool, dir: &std::path::Path) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let args = if any { vec!["--install-service".to_string(), dir.display().to_string()] } else { vec!["--uninstall-service".to_string()] };
        if !any && !status().installed {
            return Ok(());
        }
        client::elevate(&args)
    }
    #[cfg(not(target_os = "windows"))]
    Err("Zugriff ohne Anmeldung gibt es bisher nur unter Windows.".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(a: &[&str]) -> Vec<String> {
        a.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn roles_need_exact_flags() {
        assert_eq!(role_from_args(&args(&[])), Role::App);
        assert_eq!(role_from_args(&args(&["--service"])), Role::Service);
        assert_eq!(role_from_args(&args(&["--helper"])), Role::Helper);
        assert_eq!(role_from_args(&args(&["--uninstall-service"])), Role::Uninstall);
        assert_eq!(role_from_args(&args(&["--install-service", r"C:\x"])), Role::Install(PathBuf::from(r"C:\x")));
        assert_eq!(role_from_args(&args(&["--install-service"])), Role::App);
        assert_eq!(role_from_args(&args(&["peekaview://share?room=--helper"])), Role::App, "deep links never pick a role");
        assert_eq!(role_from_args(&args(&["--helper", "--service"])), Role::App);
    }

    #[test]
    fn only_served_links_count_as_changes() {
        use crate::rooms::{Pin, Room};
        let room = |unattended: bool, secret: &str| Room {
            id: "r".into(),
            name: "Büro".into(),
            secret: secret.into(),
            key: "11".repeat(32),
            pin: Some(Pin { salt: "c2FsdA==".into(), key: "a2V5".into() }),
            remote: true,
            unattended,
            apps: vec![],
            desktop: false,
            screens: vec![],
        };
        let a = room(true, "AbCdEfGhIjKlMnOpQrStUv");
        assert!(same_links(std::slice::from_ref(&a), std::slice::from_ref(&a)));
        assert!(!same_links(std::slice::from_ref(&a), &[room(true, "ZZCdEfGhIjKlMnOpQrStUv")]), "renewed");
        assert!(!same_links(std::slice::from_ref(&a), &[]), "deleted");
        assert!(same_links(&[room(false, "AbCdEfGhIjKlMnOpQrStUv")], &[room(false, "ZZCdEfGhIjKlMnOpQrStUv")]), "not served at all");
    }

    #[test]
    fn helper_restarts_slow_down() {
        let secs: Vec<u64> = (0..9).map(|f| backoff(f).as_secs()).collect();
        assert_eq!(secs, vec![0, 2, 4, 8, 16, 32, 60, 60, 60]);
    }
}
