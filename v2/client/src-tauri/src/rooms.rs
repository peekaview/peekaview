//! Permanent rooms: links that stay the same, optionally protected by a PIN and optionally open
//! for remote access – viewers can then start chosen applications (or the whole desktop) on
//! this computer themselves, which are shared automatically.
//!
//! Stored in the app data folder (`rooms.json`); a PIN is only kept as PBKDF2 key.

use std::{
    path::{Path, PathBuf},
    sync::Mutex,
};

use base64::{engine::general_purpose::STANDARD, Engine};
use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::Sha256;
use tauri::{AppHandle, Manager};

use crate::p2p::signal;

/// PBKDF2 rounds for a PIN (the browser does the same with WebCrypto).
pub const PIN_ROUNDS: u32 = 120_000;

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Pin {
    /// base64
    pub salt: String,
    /// PBKDF2-HMAC-SHA256(pin, salt, PIN_ROUNDS), base64
    pub key: String,
}

impl Pin {
    pub fn new(pin: &str) -> Pin {
        let mut salt = [0u8; 16];
        getrandom::fill(&mut salt).expect("os random");
        Pin { salt: STANDARD.encode(salt), key: STANDARD.encode(derive(pin, &salt)) }
    }

    /// Challenge-response: the viewer proves knowing the PIN with HMAC(key, nonce) – the PIN
    /// itself never travels.
    pub fn verify(&self, nonce: &str, response_hex: &str) -> bool {
        let Ok(key) = STANDARD.decode(&self.key) else { return false };
        let Ok(mut mac) = Hmac::<Sha256>::new_from_slice(&key) else { return false };
        mac.update(nonce.as_bytes());
        let Some(response) = unhex(response_hex) else { return false };
        mac.verify_slice(&response).is_ok()
    }
}

fn derive(pin: &str, salt: &[u8]) -> [u8; 32] {
    let mut out = [0u8; 32];
    pbkdf2::pbkdf2::<Hmac<Sha256>>(pin.as_bytes(), salt, PIN_ROUNDS, &mut out).expect("pbkdf2");
    out
}

fn unhex(s: &str) -> Option<Vec<u8>> {
    (s.len() % 2 == 0).then(|| (0..s.len()).step_by(2).map(|i| u8::from_str_radix(&s[i..i + 2], 16).ok()).collect::<Option<Vec<u8>>>()).flatten()
}

/// An application a remote viewer may start.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct App {
    pub id: String,
    pub name: String,
    pub path: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Room {
    pub id: String,
    pub name: String,
    pub secret: String,
    /// presenter signing key (hex)
    pub key: String,
    #[serde(default)]
    pub pin: Option<Pin>,
    /// remote access: waits for viewers even when nothing is shared, viewers may start `apps`
    #[serde(default)]
    pub remote: bool,
    #[serde(default)]
    pub apps: Vec<App>,
    /// viewers may also share the whole desktop
    #[serde(default)]
    pub desktop: bool,
}

impl Room {
    /// The part after "#" in a link.
    pub fn fragment(&self) -> String {
        let key = crate::session::parse_key(&self.key).unwrap_or_else(signal::new_signing_key);
        format!("{}.{}", self.secret, signal::public_key_b64(key))
    }

    /// For the UI – everything but the secrets.
    pub fn view(&self, site: &str) -> Value {
        json!({
            "id": self.id, "name": self.name, "link": format!("{}/#{}", site.trim().trim_end_matches('/'), self.fragment()),
            "pin": self.pin.is_some(), "remote": self.remote, "apps": self.apps, "desktop": self.desktop,
        })
    }

    /// What a remote viewer can start: [{id, name, kind}].
    pub fn launchers(&self) -> Vec<Value> {
        let mut list: Vec<Value> = self.apps.iter().map(|a| json!({ "id": a.id, "name": a.name, "kind": "app" })).collect();
        if self.desktop {
            list.push(json!({ "id": "desktop", "name": "Gesamter Desktop", "kind": "desktop" }));
        }
        list
    }
}

static ROOMS: Mutex<Option<Vec<Room>>> = Mutex::new(None);

fn file(app: &AppHandle) -> Option<PathBuf> {
    let dir = app.path().app_data_dir().ok()?;
    std::fs::create_dir_all(&dir).ok()?;
    Some(dir.join("rooms.json"))
}

pub fn all(app: &AppHandle) -> Vec<Room> {
    let mut rooms = ROOMS.lock().unwrap();
    if rooms.is_none() {
        *rooms = Some(file(app).and_then(|f| std::fs::read(f).ok()).and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default());
    }
    rooms.clone().unwrap_or_default()
}

pub fn get(app: &AppHandle, id: &str) -> Option<Room> {
    all(app).into_iter().find(|r| r.id == id)
}

/// The permanent room a secret belongs to.
pub fn by_secret(app: &AppHandle, secret: &str) -> Option<Room> {
    all(app).into_iter().find(|r| r.secret == secret)
}

fn store(app: &AppHandle, rooms: Vec<Room>) -> Result<(), String> {
    if let Some(f) = file(app) {
        std::fs::write(f, serde_json::to_vec_pretty(&rooms).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    }
    *ROOMS.lock().unwrap() = Some(rooms);
    Ok(())
}

fn new_room(name: &str) -> Room {
    Room {
        id: crate::clip::new_id(),
        name: name.to_string(),
        secret: signal::new_room_secret(),
        key: signal::new_signing_key().iter().map(|b| format!("{b:02x}")).collect(),
        pin: None,
        remote: false,
        apps: vec![],
        desktop: false,
    }
}

/// Creates or updates a room from the UI: {id?, name, remote, desktop, apps}.
pub fn save(app: &AppHandle, v: &Value) -> Result<Room, String> {
    let mut rooms = all(app);
    let name: String = v["name"].as_str().unwrap_or("").trim().chars().take(60).collect();
    let name = if name.is_empty() { format!("Raum {}", rooms.len() + 1) } else { name };
    let idx = v["id"].as_str().and_then(|id| rooms.iter().position(|r| r.id == id));
    let room = match idx {
        Some(i) => &mut rooms[i],
        None => {
            rooms.push(new_room(&name));
            rooms.last_mut().unwrap()
        }
    };
    room.name = name;
    if let Some(remote) = v["remote"].as_bool() {
        room.remote = remote;
    }
    if let Some(desktop) = v["desktop"].as_bool() {
        room.desktop = desktop;
    }
    if let Some(apps) = v["apps"].as_array() {
        room.apps = apps
            .iter()
            .filter_map(|a| {
                let path = a["path"].as_str()?.to_string();
                let name = a["name"].as_str().unwrap_or("").chars().take(60).collect();
                Some(App { id: a["id"].as_str().map(str::to_string).unwrap_or_else(crate::clip::new_id), name, path })
            })
            .take(40)
            .collect();
    }
    let room = room.clone();
    store(app, rooms)?;
    Ok(room)
}

/// Sets (at least 4 digits / characters) or removes the PIN.
pub fn set_pin(app: &AppHandle, id: &str, pin: Option<&str>) -> Result<(), String> {
    let mut rooms = all(app);
    let room = rooms.iter_mut().find(|r| r.id == id).ok_or("Raum nicht gefunden")?;
    room.pin = match pin.map(str::trim).filter(|p| !p.is_empty()) {
        Some(p) if p.chars().count() < 4 => return Err("Die PIN braucht mindestens 4 Zeichen.".into()),
        Some(p) => Some(Pin::new(p)),
        None => None,
    };
    store(app, rooms)
}

/// A new link for the room (the old one stops working).
pub fn renew(app: &AppHandle, id: &str) -> Result<(), String> {
    let mut rooms = all(app);
    let room = rooms.iter_mut().find(|r| r.id == id).ok_or("Raum nicht gefunden")?;
    let fresh = new_room(&room.name);
    room.secret = fresh.secret;
    room.key = fresh.key;
    store(app, rooms)
}

pub fn delete(app: &AppHandle, id: &str) -> Result<(), String> {
    let rooms = all(app).into_iter().filter(|r| r.id != id).collect();
    store(app, rooms)
}

// ------------------------------------------------------------------ installed applications

/// Applications installed on this computer: [{name, path}].
pub fn installed() -> Vec<Value> {
    let mut list: Vec<(String, String)> = Vec::new();
    #[cfg(target_os = "macos")]
    {
        let home = std::env::var("HOME").unwrap_or_default();
        for dir in ["/Applications", "/Applications/Utilities", "/System/Applications", "/System/Applications/Utilities", &format!("{home}/Applications")] {
            let Ok(entries) = std::fs::read_dir(dir) else { continue };
            for e in entries.flatten() {
                let path = e.path();
                if path.extension().is_some_and(|x| x == "app") {
                    let name = path.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
                    list.push((name, path.display().to_string()));
                }
            }
        }
    }
    #[cfg(target_os = "windows")]
    {
        let mut dirs = vec![PathBuf::from(std::env::var("ProgramData").unwrap_or_default()).join("Microsoft\\Windows\\Start Menu\\Programs")];
        dirs.push(PathBuf::from(std::env::var("APPDATA").unwrap_or_default()).join("Microsoft\\Windows\\Start Menu\\Programs"));
        fn walk(dir: &Path, depth: u32, list: &mut Vec<(String, String)>) {
            let Ok(entries) = std::fs::read_dir(dir) else { return };
            for e in entries.flatten() {
                let path = e.path();
                if path.is_dir() && depth < 3 {
                    walk(&path, depth + 1, list);
                } else if path.extension().is_some_and(|x| x.eq_ignore_ascii_case("lnk")) {
                    let name = path.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
                    if !name.to_lowercase().contains("uninstall") && !name.to_lowercase().contains("deinstall") {
                        list.push((name, path.display().to_string()));
                    }
                }
            }
        }
        for d in dirs {
            walk(&d, 0, &mut list);
        }
    }
    list.sort_by_key(|(n, _)| n.to_lowercase());
    list.dedup_by(|a, b| a.0 == b.0);
    list.into_iter().map(|(name, path)| json!({ "name": name, "path": path })).collect()
}

/// Starts an application (or brings it to the front if it runs already).
pub fn launch(path: &str) -> Result<(), String> {
    let p = Path::new(path);
    if !p.exists() {
        return Err("Anwendung nicht gefunden".into());
    }
    #[cfg(target_os = "macos")]
    let result = std::process::Command::new("open").arg("-a").arg(p).spawn();
    #[cfg(target_os = "windows")]
    let result = std::process::Command::new("cmd").args(["/C", "start", ""]).arg(p).spawn();
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let result = std::process::Command::new(p).spawn();
    result.map(|_| ()).map_err(|e| e.to_string())
}

/// Process ids of a running application (macOS: processes inside the .app bundle).
pub fn pids_of(path: &str) -> Vec<u32> {
    #[cfg(target_os = "macos")]
    {
        let Ok(out) = std::process::Command::new("ps").args(["-axo", "pid=,comm="]).output() else { return vec![] };
        let prefix = format!("{}/", path.trim_end_matches('/'));
        String::from_utf8_lossy(&out.stdout)
            .lines()
            .filter_map(|l| {
                let l = l.trim();
                let (pid, comm) = l.split_once(' ')?;
                comm.trim().starts_with(&prefix).then(|| pid.parse().ok()).flatten()
            })
            .collect()
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = path;
        vec![]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pin_challenge_response() {
        let pin = Pin::new("4711");
        let key = STANDARD.decode(&pin.key).unwrap();
        let mut mac = Hmac::<Sha256>::new_from_slice(&key).unwrap();
        mac.update(b"nonce-1");
        let good: String = mac.finalize().into_bytes().iter().map(|b| format!("{b:02x}")).collect();
        assert!(pin.verify("nonce-1", &good));
        assert!(!pin.verify("nonce-2", &good), "bound to the nonce");
        assert!(!Pin::new("4712").verify("nonce-1", &good), "other PIN");
        assert!(!pin.verify("nonce-1", "zz"));
    }
}
