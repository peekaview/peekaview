//! The links the service keeps reachable without sign-in: `%ProgramData%\PeekaView\unattended.json`,
//! written only by the elevated install step (only SYSTEM and administrators may write there).
//!
//! What goes in is cut down to what is safe for a SYSTEM process: only permanent links with remote
//! access, a PIN and "Auch ohne Anmeldung"; no applications (they would run as SYSTEM), only the
//! whole desktop.

use std::sync::Mutex;

use serde::{Deserialize, Serialize};

use crate::rooms::Room;

/// More links than anybody needs; a bound for what a SYSTEM process reads.
const MAX_ROOMS: usize = 20;
const MAX_RELAYS: usize = 10;

#[derive(Serialize, Deserialize, Default, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct Store {
    /// the computer's name as viewers see it
    #[serde(default)]
    pub name: String,
    /// Nostr relays (empty: the defaults)
    #[serde(default)]
    pub relays: Vec<String>,
    #[serde(default)]
    pub rooms: Vec<Room>,
}

fn valid_secret(s: &str) -> bool {
    (16..=64).contains(&s.len()) && s.chars().all(|c| c.is_ascii_alphanumeric() || "-_".contains(c))
}

fn valid_relay(r: &str) -> bool {
    r.len() <= 200 && r.starts_with("wss://") && r.len() > 6 && !r.chars().any(|c| c.is_control() || c.is_whitespace())
}

/// Keeps only what the service may serve.
pub fn sanitize(name: &str, relays: &[String], rooms: Vec<Room>) -> Store {
    let rooms = rooms
        .into_iter()
        .filter(|r| r.remote && r.unattended && r.pin.is_some())
        .filter(|r| valid_secret(&r.secret) && crate::session::parse_key(&r.key).is_some())
        .take(MAX_ROOMS)
        .map(|mut r| {
            r.name = r.name.chars().filter(|c| !c.is_control()).take(60).collect();
            r.apps.clear();
            r.screens.clear();
            r.desktop = true;
            r
        })
        .collect();
    Store {
        name: name.chars().filter(|c| !c.is_control()).take(60).collect(),
        relays: relays.iter().filter(|r| valid_relay(r)).take(MAX_RELAYS).cloned().collect(),
        rooms,
    }
}

/// Parses the store file and applies the same rules again (never trust the file blindly).
pub fn parse(bytes: &[u8]) -> Result<Store, String> {
    if bytes.len() > 1_000_000 {
        return Err("unattended.json is too large".into());
    }
    let s: Store = serde_json::from_slice(bytes).map_err(|e| e.to_string())?;
    Ok(sanitize(&s.name, &s.relays, s.rooms))
}

pub fn path() -> std::path::PathBuf {
    super::data_dir().join("unattended.json")
}

static CACHE: Mutex<Option<Store>> = Mutex::new(None);

/// The links (read once, again after [`reload`]).
pub fn get() -> Store {
    let mut cache = CACHE.lock().unwrap();
    if cache.is_none() {
        *cache = Some(std::fs::read(path()).ok().and_then(|b| parse(&b).map_err(|e| crate::log(&format!("unattended store: {e}"))).ok()).unwrap_or_default());
    }
    cache.clone().unwrap_or_default()
}

#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
pub fn reload() {
    *CACHE.lock().unwrap() = None;
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::rooms::{App, Pin, Screen};

    fn room(remote: bool, unattended: bool, pin: bool) -> Room {
        Room {
            id: "r1".into(),
            name: "Büro\nPC".into(),
            secret: "AbCdEfGhIjKlMnOpQrStUv".into(),
            key: "11".repeat(32),
            pin: pin.then(|| Pin { salt: "c2FsdA==".into(), key: "a2V5".into() }),
            remote,
            unattended,
            apps: vec![App { id: "a".into(), name: "cmd".into(), path: "C:\\Windows\\System32\\cmd.exe".into() }],
            desktop: false,
            screens: vec![Screen { id: "screen:1".into(), name: "1".into() }],
        }
    }

    #[test]
    fn only_remote_links_with_pin_and_flag() {
        let s = sanitize("PC", &[], vec![room(true, true, true), room(false, true, true), room(true, false, true), room(true, true, false)]);
        assert_eq!(s.rooms.len(), 1);
    }

    #[test]
    fn no_applications_only_the_desktop() {
        let s = sanitize("PC", &[], vec![room(true, true, true)]);
        let r = &s.rooms[0];
        assert!(r.apps.is_empty(), "applications would run as SYSTEM");
        assert!(r.screens.is_empty());
        assert!(r.desktop);
        assert_eq!(r.name, "BüroPC");
    }

    #[test]
    fn bad_secrets_keys_and_relays_are_dropped() {
        let mut bad_secret = room(true, true, true);
        bad_secret.secret = "../../etc".into();
        let mut bad_key = room(true, true, true);
        bad_key.key = "zz".into();
        let relays = vec!["wss://relay.example".to_string(), "http://plain".into(), "wss://a b".into(), "wss://".into()];
        let s = sanitize("PC", &relays, vec![bad_secret, bad_key]);
        assert!(s.rooms.is_empty());
        assert_eq!(s.relays, vec!["wss://relay.example".to_string()]);
    }

    #[test]
    fn parse_applies_the_rules_and_rejects_unknown_fields() {
        let json = serde_json::to_vec(&Store { name: "PC".into(), relays: vec![], rooms: vec![room(true, true, true), room(true, false, true)] }).unwrap();
        let s = parse(&json).unwrap();
        assert_eq!(s.rooms.len(), 1);
        assert!(s.rooms[0].apps.is_empty());
        assert!(parse(br#"{"name":"PC","exec":"calc"}"#).is_err());
        assert!(parse(b"[").is_err());
    }
}
