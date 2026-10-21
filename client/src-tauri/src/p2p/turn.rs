//! ICE configuration: public STUN plus optional TURN with short-lived credentials.
//!
//! The TURN secret (coturn `static-auth-secret`, "TURN REST API") only lives in the presenter's
//! client. For every session it derives credentials that expire after `TTL` and hands them to
//! its viewers inside the end-to-end encrypted signaling – the static website never sees a secret.

use base64::{engine::general_purpose::STANDARD, Engine};
use hmac::{Hmac, Mac};
use serde_json::{json, Value};
use sha1::Sha1;

pub const DEFAULT_STUN: [&str; 2] = ["stun:stun.l.google.com:19302", "stun:stun.cloudflare.com:3478"];
const TTL: u64 = 8 * 3600;

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
