//! The viewer website, served over Nostr – no web server of our own.
//!
//! The desktop client carries the viewer site and publishes it as an nsite (NIP-5A) under a key of
//! its own: the files go to public Blossom servers (content-addressed by SHA-256), a signed
//! manifest (kind 15128) maps every path to its hash, plus the server list (kind 10063) and relay
//! list (kind 10002) so gateways find everything. Share links then point to
//! `https://<npub>.nsite.lol/#…` – any nsite gateway serves the same, hash-checked files.
//!
//! Published again when the bundled site changed, or once a week (relays may forget). Files of
//! earlier versions are deleted from the Blossom servers afterwards; with an own viewer site
//! configured, the nsite is taken down completely.

use std::{
    sync::Mutex,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter, Manager};
use tokio_tungstenite::tungstenite::Message;

use crate::p2p::signal;

/// Files of the viewer site (as bundled from `web/`).
const FILES: [&str; 11] = [
    "index.html",
    "viewer.js",
    "signal.js",
    "annotate.js",
    "icons.js",
    "voice.js",
    "clipboard.js",
    "windows.js",
    "vendor/noble-schnorr.js",
    "vendor/pdfjs/pdf.min.mjs",
    "vendor/pdfjs/pdf.worker.min.mjs",
];
const BLOSSOM: [&str; 3] = ["https://blossom.primal.net", "https://nostr.download", "https://blossom.band"];
/// where gateways look up a user's relay and server lists
const LOOKUP_RELAYS: [&str; 2] = ["wss://purplepag.es", "wss://user.kindpag.es"];
pub const DEFAULT_GATEWAY: &str = "nsite.lol";
const REPUBLISH: Duration = Duration::from_secs(7 * 24 * 3600);

static STATUS: Mutex<Option<Value>> = Mutex::new(None);

fn now() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

// ------------------------------------------------------------------ bech32 (npub)

const CHARSET: &[u8; 32] = b"qpzry9x8gf2tvdw0s3jn54khce6mua7l";

fn polymod(values: &[u8]) -> u32 {
    const GEN: [u32; 5] = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
    let mut chk = 1u32;
    for v in values {
        let top = chk >> 25;
        chk = ((chk & 0x1ff_ffff) << 5) ^ *v as u32;
        for (i, g) in GEN.iter().enumerate() {
            if (top >> i) & 1 == 1 {
                chk ^= g;
            }
        }
    }
    chk
}

fn bech32(hrp: &str, data: &[u8]) -> String {
    let mut five = Vec::new();
    let (mut acc, mut bits) = (0u32, 0u32);
    for b in data {
        acc = (acc << 8) | *b as u32;
        bits += 8;
        while bits >= 5 {
            bits -= 5;
            five.push(((acc >> bits) & 31) as u8);
        }
    }
    if bits > 0 {
        five.push(((acc << (5 - bits)) & 31) as u8);
    }
    let mut values: Vec<u8> = hrp.bytes().map(|b| b >> 5).collect();
    values.push(0);
    values.extend(hrp.bytes().map(|b| b & 31));
    values.extend(&five);
    values.extend([0u8; 6]);
    let pm = polymod(&values) ^ 1;
    let checksum = (0..6).map(|i| ((pm >> (5 * (5 - i))) & 31) as u8);
    let mut out = format!("{hrp}1");
    out.extend(five.into_iter().chain(checksum).map(|v| CHARSET[v as usize] as char));
    out
}

pub fn npub(pubkey: [u8; 32]) -> String {
    bech32("npub", &pubkey)
}

// ------------------------------------------------------------------ key & state

fn state_file(app: &AppHandle) -> Option<std::path::PathBuf> {
    let dir = app.path().app_data_dir().ok()?;
    std::fs::create_dir_all(&dir).ok()?;
    Some(dir.join("nsite.json"))
}

fn state(app: &AppHandle) -> Value {
    state_file(app).and_then(|f| std::fs::read(f).ok()).and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_else(|| json!({}))
}

fn save_state(app: &AppHandle, v: &Value) {
    if let Some(f) = state_file(app) {
        let _ = std::fs::write(f, serde_json::to_vec_pretty(v).unwrap_or_default());
    }
}

/// This installation's site key (made on first use).
fn key(app: &AppHandle) -> [u8; 32] {
    let mut st = state(app);
    if let Some(k) = st["key"].as_str().and_then(crate::session::parse_key) {
        return k;
    }
    let k = signal::new_signing_key();
    st["key"] = json!(hex(&k));
    save_state(app, &st);
    k
}

fn gateway(app: &AppHandle) -> String {
    crate::settings::text(app, "nsite_gateway").unwrap_or_else(|| DEFAULT_GATEWAY.into())
}

/// Address of the viewer site on Nostr.
pub fn site_url(app: &AppHandle) -> String {
    format!("https://{}.{}", npub(signal::public_key(key(app))), gateway(app))
}

/// The viewer site for links: the configured address, or (empty / "nostr") the nsite.
pub fn resolve(app: &AppHandle, site: &str) -> String {
    let site = site.trim().trim_end_matches('/');
    if site.is_empty() || site.eq_ignore_ascii_case("nostr") {
        site_url(app)
    } else {
        site.to_string()
    }
}

pub fn status(app: &AppHandle) -> Value {
    STATUS.lock().unwrap().clone().unwrap_or_else(|| {
        let st = state(app);
        json!({ "url": site_url(app), "state": if st["published"].is_u64() { "ok" } else { "idle" }, "published": st["published"] })
    })
}

fn set_status(app: &AppHandle, v: Value) {
    *STATUS.lock().unwrap() = Some(v.clone());
    let _ = app.emit("nsite", v);
}

// ------------------------------------------------------------------ publishing

struct File {
    path: String,
    bytes: Vec<u8>,
    mime: String,
    sha: String,
}

fn site_files(app: &AppHandle) -> Result<Vec<File>, String> {
    let resolver = app.asset_resolver();
    FILES
        .iter()
        .map(|name| {
            let asset = resolver.get(name.to_string()).ok_or_else(|| format!("{name} fehlt im Programm"))?;
            let sha = hex(&Sha256::digest(&asset.bytes));
            Ok(File { path: format!("/{name}"), mime: asset.mime_type.clone(), bytes: asset.bytes, sha })
        })
        .collect()
}

/// NIP-5A aggregate hash: sorted "<sha256> <path>\n" lines.
fn aggregate(files: &[File]) -> String {
    let mut lines: Vec<String> = files.iter().map(|f| format!("{} {}\n", f.sha, f.path)).collect();
    lines.sort();
    hex(&Sha256::digest(lines.concat().as_bytes()))
}

/// Uploads one blob unless the server has it already (BUD-01 HEAD, BUD-02 PUT /upload, BUD-11 auth).
fn upload(server: &str, file: &File, secret: [u8; 32]) -> Result<(), String> {
    // BUD-11 says base64url, some servers (e.g. Primal) only take standard base64
    upload_with(server, file, secret, true, true).or_else(|_| upload_with(server, file, secret, true, false))
}

/// `typed`: send our Content-Type (some servers sniff it themselves and refuse a mismatch);
/// `url_safe`: BUD-11 base64url token (older servers want standard base64).
fn upload_with(server: &str, file: &File, secret: [u8; 32], typed: bool, url_safe: bool) -> Result<(), String> {
    if ureq::head(&format!("{server}/{}", file.sha)).call().is_ok() {
        return Ok(());
    }
    let auth = signal::sign_event(
        secret,
        24242,
        json!([["t", "upload"], ["x", file.sha], ["expiration", (now() + 600).to_string()]]),
        &format!("Upload {}", file.path.trim_start_matches('/')),
    );
    let token = if url_safe { URL_SAFE_NO_PAD.encode(auth.to_string()) } else { base64::engine::general_purpose::STANDARD.encode(auth.to_string()) };
    let agent: ureq::Agent = ureq::Agent::config_builder().http_status_as_error(false).build().into();
    let mut request = agent.put(&format!("{server}/upload")).header("Authorization", &format!("Nostr {token}")).header("X-SHA-256", &file.sha);
    if typed {
        request = request.header("Content-Type", &file.mime);
    }
    let response = request.send(&file.bytes[..]).map_err(|e| format!("{server}: {e}"))?;
    if response.status().is_success() {
        return Ok(());
    }
    // servers explain refusals in X-Reason
    let reason = response.headers().get("x-reason").and_then(|v| v.to_str().ok()).unwrap_or("").to_string();
    Err(format!("{server}: {} {reason}", response.status().as_u16()))
}

/// Deletes a blob from a server (BUD-02 DELETE, BUD-11 auth with t=delete).
fn delete_blob(server: &str, sha: &str, secret: [u8; 32]) -> Result<(), String> {
    let attempt = |url_safe: bool| -> Result<(), String> {
        let auth = signal::sign_event(secret, 24242, json!([["t", "delete"], ["x", sha], ["expiration", (now() + 600).to_string()]]), "Delete old PeekaView file");
        let token = if url_safe { URL_SAFE_NO_PAD.encode(auth.to_string()) } else { base64::engine::general_purpose::STANDARD.encode(auth.to_string()) };
        let agent: ureq::Agent = ureq::Agent::config_builder().http_status_as_error(false).build().into();
        let response = agent.delete(&format!("{server}/{sha}")).header("Authorization", &format!("Nostr {token}")).call().map_err(|e| e.to_string())?;
        // gone already counts as done
        if response.status().is_success() || response.status().as_u16() == 404 {
            Ok(())
        } else {
            Err(format!("{server}: {}", response.status().as_u16()))
        }
    };
    attempt(true).or_else(|_| attempt(false))
}

/// Blobs we have on servers: {server: [sha256 …]} – deletes those not in `keep`.
fn delete_except(app: &AppHandle, keep: &[String], keep_servers: &[String]) -> Value {
    let secret = key(app);
    let st = state(app);
    let mut left = serde_json::Map::new();
    for (server, shas) in st["blobs"].as_object().cloned().unwrap_or_default() {
        let mut remaining = Vec::new();
        for sha in shas.as_array().into_iter().flatten().filter_map(|s| s.as_str()) {
            let still_used = keep_servers.contains(&server) && keep.iter().any(|k| k == sha);
            if !still_used && delete_blob(&server, sha, secret).is_err() {
                remaining.push(json!(sha));
            }
        }
        if !remaining.is_empty() {
            left.insert(server, Value::Array(remaining));
        }
    }
    Value::Object(left)
}

/// Takes the nsite down: all files off the servers, the manifest deleted (NIP-09) – used when
/// an own viewer site is configured.
pub fn unpublish(app: &AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || {
        let st = state(&app);
        if st["published"].is_null() && st["blobs"].as_object().is_none_or(|b| b.is_empty()) {
            return;
        }
        let secret = key(&app);
        let pubkey = hex(&signal::public_key(secret));
        let leftovers = delete_except(&app, &[], &[]);
        let deletion = signal::sign_event(secret, 5, json!([["a", format!("15128:{pubkey}:")], ["k", "15128"]]), "PeekaView viewer site taken down");
        let mut relays: Vec<String> = crate::settings::lines(&app, "relays");
        if relays.is_empty() {
            relays = signal::DEFAULT_RELAYS.iter().map(|r| r.to_string()).collect();
        }
        relays.extend(LOOKUP_RELAYS.iter().map(|r| r.to_string()));
        tauri::async_runtime::block_on(futures_util::future::join_all(relays.iter().map(|r| publish_to(r, std::slice::from_ref(&deletion)))));
        let mut st = state(&app);
        st["blobs"] = leftovers;
        st["published"] = Value::Null;
        st["hash"] = Value::Null;
        save_state(&app, &st);
        crate::log("nsite: taken down");
        *STATUS.lock().unwrap() = None;
        let _ = app.emit("nsite", status(&app));
    });
}

/// Sends events to a relay; true if it accepted all of them.
async fn publish_to(relay: &str, events: &[Value]) -> bool {
    let Ok(Ok((mut ws, _))) = tokio::time::timeout(Duration::from_secs(6), tokio_tungstenite::connect_async(relay)).await else { return false };
    for e in events {
        if ws.send(Message::Text(json!(["EVENT", e]).to_string().into())).await.is_err() {
            return false;
        }
    }
    let mut ok = 0;
    let deadline = tokio::time::Instant::now() + Duration::from_secs(8);
    while ok < events.len() {
        match tokio::time::timeout_at(deadline, ws.next()).await {
            Ok(Some(Ok(Message::Text(t)))) => {
                if let Ok(v) = serde_json::from_str::<Value>(&t) {
                    if v[0] == "OK" && v[2] == true {
                        ok += 1;
                    }
                }
            }
            Ok(Some(Ok(_))) => {}
            _ => break,
        }
    }
    let _ = ws.close(None).await;
    ok == events.len()
}

fn publish(app: &AppHandle, files: &[File], hash: &str) -> Result<Vec<String>, String> {
    let secret = key(app);
    let mut servers = Vec::new();
    let mut errors = Vec::new();
    for server in BLOSSOM {
        match files.iter().try_for_each(|f| upload(server, f, secret)) {
            Ok(()) => servers.push(server.to_string()),
            Err(e) => errors.push(e),
        }
    }
    if servers.is_empty() {
        return Err(format!("Kein Blossom-Server nahm die Dateien an ({})", errors.join("; ")));
    }
    let mut relays: Vec<String> = crate::settings::lines(app, "relays");
    if relays.is_empty() {
        relays = signal::DEFAULT_RELAYS.iter().map(|r| r.to_string()).collect();
    }
    let mut manifest_tags: Vec<Value> = files.iter().map(|f| json!(["path", f.path, f.sha])).collect();
    manifest_tags.extend(servers.iter().map(|s| json!(["server", s])));
    manifest_tags.push(json!(["x", hash, "aggregate"]));
    manifest_tags.push(json!(["title", "PeekaView"]));
    manifest_tags.push(json!(["description", "Bildschirmfreigabe ansehen – peer-to-peer, ohne eigenen Server"]));
    let events = vec![
        signal::sign_event(secret, 10002, Value::Array(relays.iter().map(|r| json!(["r", r])).collect()), ""),
        signal::sign_event(secret, 10063, Value::Array(servers.iter().map(|s| json!(["server", s])).collect()), ""),
        signal::sign_event(secret, 15128, Value::Array(manifest_tags), ""),
    ];
    let mut targets = relays.clone();
    targets.extend(LOOKUP_RELAYS.iter().map(|r| r.to_string()));
    targets.dedup();
    let accepted = tauri::async_runtime::block_on(async {
        let results = futures_util::future::join_all(targets.iter().map(|r| publish_to(r, &events))).await;
        results.into_iter().filter(|ok| *ok).count()
    });
    if accepted == 0 {
        return Err("Kein Relay nahm die Seite an".into());
    }
    crate::log(&format!("nsite: published to {} servers ({}), {accepted} relays{}", servers.len(), servers.join(", "), if errors.is_empty() { String::new() } else { format!(" – refused: {}", errors.join("; ")) }));
    Ok(servers)
}

/// Publishes the viewer site if it changed (or a week has passed); in the background.
pub fn publish_if_needed(app: &AppHandle, force: bool) {
    let app = app.clone();
    std::thread::spawn(move || {
        let files = match site_files(&app) {
            Ok(f) => f,
            Err(e) => return set_status(&app, json!({ "url": site_url(&app), "state": "error", "error": e })),
        };
        let hash = aggregate(&files);
        let st = state(&app);
        let fresh = st["hash"] == hash.as_str() && st["published"].as_u64().is_some_and(|t| now().saturating_sub(t) < REPUBLISH.as_secs());
        if fresh && !force {
            return set_status(&app, json!({ "url": site_url(&app), "state": "ok", "published": st["published"] }));
        }
        set_status(&app, json!({ "url": site_url(&app), "state": "publishing" }));
        match publish(&app, &files, &hash) {
            Ok(servers) => {
                // files of earlier versions are no longer needed
                let shas: Vec<String> = files.iter().map(|f| f.sha.clone()).collect();
                let mut blobs = delete_except(&app, &shas, &servers);
                if let Some(map) = blobs.as_object_mut() {
                    for server in &servers {
                        let mut list: Vec<Value> = map.get(server).and_then(|v| v.as_array().cloned()).unwrap_or_default();
                        for sha in &shas {
                            if !list.iter().any(|v| v == sha.as_str()) {
                                list.push(json!(sha));
                            }
                        }
                        map.insert(server.clone(), Value::Array(list));
                    }
                }
                let mut st = state(&app);
                st["hash"] = json!(hash);
                st["published"] = json!(now());
                st["blobs"] = blobs;
                save_state(&app, &st);
                set_status(&app, json!({ "url": site_url(&app), "state": "ok", "published": st["published"] }));
            }
            Err(e) => {
                crate::log(&format!("nsite: {e}"));
                set_status(&app, json!({ "url": site_url(&app), "state": "error", "error": e }));
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn npub_encoding() {
        let pk: [u8; 32] = (0..32).map(|i| u8::from_str_radix(&"3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d"[i * 2..i * 2 + 2], 16).unwrap()).collect::<Vec<_>>().try_into().unwrap();
        assert_eq!(npub(pk), "npub180cvv07tjdrrgpa0j7j7tmnyl2yr6yr7l8j4s3evf6u64th6gkwsyjh6w6");
    }

    /// Which Blossom servers take an upload: `cargo test blossom_upload -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn blossom_upload() {
        let bytes = format!("peekaview blossom test {}", now()).into_bytes();
        let file = File { path: "/test.txt".into(), sha: hex(&Sha256::digest(&bytes)), bytes, mime: "text/plain".into() };
        let key = signal::new_signing_key();
        for server in BLOSSOM {
            let uploaded = upload(server, &file, key);
            let deleted = uploaded.is_ok().then(|| delete_blob(server, &file.sha, key));
            let gone = ureq::head(&format!("{server}/{}", file.sha)).call().is_err();
            println!("{server}: upload {uploaded:?}, delete {deleted:?}, gone afterwards: {gone}");
        }
    }

    #[test]
    fn aggregate_hash_is_order_independent() {
        let f = |p: &str, s: &str| File { path: p.into(), bytes: vec![], mime: String::new(), sha: s.into() };
        assert_eq!(aggregate(&[f("/a.js", "11"), f("/index.html", "22")]), aggregate(&[f("/index.html", "22"), f("/a.js", "11")]));
    }
}
