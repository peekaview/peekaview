//! Talking to the daemon over its socket, and running the setup step as root.

use std::{os::unix::net::UnixStream, process::Command, time::Duration};

use super::{
    super::{
        protocol::{self, Request, Response},
        store::Store,
        Status,
    },
    SOCKET,
};

/// One request, one answer.
pub fn request(req: &Request) -> Result<Response, String> {
    let mut s = UnixStream::connect(SOCKET).map_err(|e| format!("Der PeekaView-Dienst ist nicht erreichbar ({e})."))?;
    let _ = s.set_read_timeout(Some(Duration::from_secs(30)));
    let _ = s.set_write_timeout(Some(Duration::from_secs(5)));
    protocol::write(&mut s, req).map_err(|e| e.to_string())?;
    protocol::read(&mut s).map_err(|e| e.to_string())
}

pub fn installed() -> bool {
    super::daemon_plist().exists()
}

/// Status plus FileVault (on, authenticated restart possible).
pub fn status() -> (Status, bool, bool) {
    match request(&Request::Status {}) {
        Ok(Response::Status { version, filevault, authrestart, .. }) => (Status { installed: true, running: true, version: Some(version) }, filevault, authrestart),
        _ => (Status { installed: installed(), running: false, version: None }, false, false),
    }
}

/// The links for the agent.
pub fn links() -> Result<Store, String> {
    match request(&Request::Links {})? {
        Response::Links { store } => Ok(store),
        Response::Error { message } => Err(message),
        _ => Err("Unerwartete Antwort des Dienstes.".into()),
    }
}

pub fn log(link: &str, viewer: &str, event: &str) {
    let _ = request(&Request::Log { link: link.into(), viewer: viewer.into(), event: event.into() });
}

pub fn restart(user: Option<String>, password: Option<String>) -> Result<(), String> {
    match request(&Request::Restart { user, password })? {
        Response::Ok {} => Ok(()),
        Response::Error { message } => Err(message),
        _ => Err("Unerwartete Antwort des Dienstes.".into()),
    }
}

/// Runs this program with `args` as root – macOS asks for an administrator's password.
pub fn elevate(args: &[String]) -> Result<(), String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let script = super::admin_script(&exe, args, "PeekaView möchte den Fernzugriff ohne Anmeldung einrichten oder ändern.");
    let out = Command::new("/usr/bin/osascript").arg("-e").arg(script).output().map_err(|e| e.to_string())?;
    if out.status.success() {
        return Ok(());
    }
    let err = String::from_utf8_lossy(&out.stderr);
    crate::log(&format!("unattended: setup step failed: {}", err.trim()));
    // -128: the user cancelled the password prompt
    if err.contains("-128") {
        Err("Ohne Administratorrechte lässt sich der Zugriff ohne Anmeldung nicht einrichten.".into())
    } else {
        Err("Der Dienst ließ sich nicht einrichten. Details stehen im PeekaView-Protokoll.".into())
    }
}
