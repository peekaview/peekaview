//! ICE configuration: public STUN plus TURN with short-lived credentials.
//!
//! TURN comes from PeekaView's service (`?action=turn`): it derives credentials from the coturn
//! `static-auth-secret` that only it knows – nobody has to set up a TURN server, and no secret is
//! in this app. A presenter hands them to its viewers inside the end-to-end encrypted signaling.
//! An own TURN server and secret from older settings still work as a fallback.

use std::{
    sync::Mutex,
    time::{Duration, Instant},
};

use base64::{engine::general_purpose::STANDARD, Engine};
use hmac::{Hmac, Mac};
use serde_json::{json, Value};
use sha1::Sha1;

pub const DEFAULT_STUN: [&str; 2] = ["stun:stun.l.google.com:19302", "stun:stun.cloudflare.com:3478"];
const TTL: u64 = 8 * 3600;
/// PeekaView's service (the contacts server also hands out TURN credentials)
pub const SERVICE: &str = "https://peekaview.devxpert.de/api.php";
/// fetched credentials are used for a share that starts within this time (they stay valid much
/// longer, so a running share keeps its relay)
const FRESH: Duration = Duration::from_secs(3600);

static FETCHED: Mutex<Option<(Instant, Value)>> = Mutex::new(None);

/// TURN servers with credentials from PeekaView's service, cached for a while; None when it is
/// unreachable or has no TURN configured.
pub fn from_service() -> Option<Value> {
    if let Some((at, servers)) = FETCHED.lock().unwrap().as_ref() {
        if at.elapsed() < FRESH {
            return Some(servers.clone());
        }
    }
    let agent: ureq::Agent = ureq::Agent::config_builder().timeout_global(Some(Duration::from_secs(4))).max_redirects(0).http_status_as_error(false).build().into();
    let mut response = agent.post(&format!("{SERVICE}?action=turn")).header("Content-Type", "application/json").send(b"{}".as_slice()).ok()?;
    if response.status().as_u16() != 200 {
        crate::log(&format!("turn: service answered {}", response.status()));
        return None;
    }
    let body: Value = serde_json::from_str(&response.body_mut().with_config().limit(64_000).read_to_string().ok()?).ok()?;
    let servers: Vec<Value> = body["iceServers"].as_array()?.iter().filter(|s| s["urls"].is_array() && s["username"].is_string() && s["credential"].is_string()).cloned().collect();
    if servers.is_empty() {
        return None;
    }
    let servers = Value::Array(servers);
    *FETCHED.lock().unwrap() = Some((Instant::now(), servers.clone()));
    Some(servers)
}

/// At the start of the app: the first share needs not wait for the service.
pub fn prefetch() {
    std::thread::spawn(|| {
        let got = from_service().is_some();
        crate::log(&format!("turn: {}", if got { "credentials from the PeekaView service" } else { "none from the PeekaView service" }));
    });
}

/// STUN, TURN from the service – or, when it is unreachable, an own TURN server from the settings.
pub fn ice_for_share(turn_urls: &[String], secret: Option<&str>) -> Value {
    match from_service() {
        Some(Value::Array(turn)) => {
            let mut servers = vec![json!({ "urls": DEFAULT_STUN })];
            servers.extend(turn);
            Value::Array(servers)
        }
        _ => ice_servers(turn_urls, secret, "peekaview"),
    }
}

/// `turn_urls` e.g. ["turn:turn.example.com:3478?transport=udp", "turns:turn.example.com:443?transport=tcp"]
pub fn ice_servers(turn_urls: &[String], secret: Option<&str>, label: &str) -> Value {
    let mut servers = vec![json!({ "urls": DEFAULT_STUN })];
    if let (false, Some(secret)) = (turn_urls.is_empty(), secret.filter(|s| !s.is_empty())) {
        let expires = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0) + TTL;
        let username = format!("{expires}:{label}");
        let mut mac = Hmac::<Sha1>::new_from_slice(secret.as_bytes()).expect("any key length");
        mac.update(username.as_bytes());
        let credential = STANDARD.encode(mac.finalize().into_bytes());
        servers.push(json!({ "urls": turn_urls, "username": username, "credential": credential }));
    }
    Value::Array(servers)
}

#[cfg(test)]
mod tests {
    #[test]
    fn coturn_rest_credentials() {
        // same scheme as coturn's use-auth-secret: base64(HMAC-SHA1(secret, "expiry:label"))
        let ice = super::ice_servers(&["turn:t.example:3478".into()], Some("geheim"), "pv");
        let turn = &ice[1];
        let username = turn["username"].as_str().unwrap();
        assert!(username.ends_with(":pv"));
        assert_eq!(turn["credential"].as_str().unwrap().len(), 28);
        assert_eq!(super::ice_servers(&[], Some("x"), "pv").as_array().unwrap().len(), 1);
    }
}
