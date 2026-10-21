//! Serverless signaling over public Nostr relays – the Rust twin of `web/signal.js`.
//!
//! topic = SHA-256("peekaview/topic/v1:" + secret), key = SHA-256("peekaview/key/v1:" + secret);
//! every message is AES-256-GCM encrypted and sent as an ephemeral event (kind 25050) signed by a
//! throw-away key. Only the WebRTC setup goes this way.

use std::{
    collections::{HashSet, VecDeque},
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use base64::{engine::general_purpose::STANDARD, Engine};
use futures_util::{SinkExt, StreamExt};
use secp256k1::{schnorr, Keypair};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tokio::sync::{broadcast, mpsc};
use tokio_tungstenite::tungstenite::Message;

pub const KIND: u64 = 25050;
/// Public relays that pass ephemeral events on quickly (checked 2026-10); several, so one that is
/// down or throttling does not matter.
pub const DEFAULT_RELAYS: [&str; 5] = ["wss://nos.lol", "wss://relay.primal.net", "wss://relay.snort.social", "wss://nostr.mom", "wss://relay.damus.io"];

fn sha256(data: impl AsRef<[u8]>) -> [u8; 32] {
    Sha256::digest(data.as_ref()).into()
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn now() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

/// A fresh room secret (base64url, 22 characters).
pub fn new_room_secret() -> String {
    let mut bytes = [0u8; 16];
    getrandom::fill(&mut bytes).expect("os random");
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}

/// A fresh secp256k1 secret key for signing a room's events.
pub fn new_signing_key() -> [u8; 32] {
    loop {
        let mut sk = [0u8; 32];
        getrandom::fill(&mut sk).expect("os random");
        if Keypair::from_secret_bytes(sk).is_ok() {
            return sk;
        }
    }
}

/// Public half of a signing key, base64url – the part after the "." in a share link.
pub fn public_key_b64(signing_key: [u8; 32]) -> String {
    let keypair = Keypair::from_secret_bytes(signing_key).expect("valid key");
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(keypair.x_only_public_key().0.to_byte_array())
}

/// A signed Nostr event (NIP-01) – e.g. for publishing the viewer site (nsite).
pub fn sign_event(secret_key: [u8; 32], kind: u64, tags: Value, content: &str) -> Value {
    let keypair = Keypair::from_secret_bytes(secret_key).unwrap_or_else(|_| Keypair::from_secret_bytes(new_signing_key()).expect("valid key"));
    let pubkey = hex(&keypair.x_only_public_key().0.to_byte_array());
    let created_at = now();
    let id = sha256(json!([0, pubkey, created_at, kind, tags, content]).to_string());
    let sig = schnorr::sign_no_aux_rand(&id, &keypair).to_byte_array();
    json!({ "id": hex(&id), "pubkey": pubkey, "created_at": created_at, "kind": kind, "tags": tags, "content": content, "sig": hex(&sig) })
}

/// x-only public key of a secret key.
pub fn public_key(secret_key: [u8; 32]) -> [u8; 32] {
    Keypair::from_secret_bytes(secret_key).expect("valid key").x_only_public_key().0.to_byte_array()
}

#[derive(Clone)]
pub struct Signaling {
    topic: String,
    cipher: Arc<Aes256Gcm>,
    keypair: Keypair,
    pubkey: String,
    out: broadcast::Sender<String>,
    /// recent events, re-sent to relays that connect later (nothing is lost while connecting)
    recent: Arc<Mutex<VecDeque<(Instant, String)>>>,
    stop: Arc<std::sync::atomic::AtomicBool>,
}

impl Signaling {
    /// Connects to the relays; decrypted messages of the room arrive on the returned receiver.
    /// `signing_key`: the presenter's room key (see [`new_signing_key`]); viewers pin its public half.
    pub fn open(secret: &str, relays: &[String], signing_key: [u8; 32]) -> (Self, mpsc::UnboundedReceiver<Value>) {
        let topic = hex(&sha256(format!("peekaview/topic/v1:{secret}")));
        let cipher = Arc::new(Aes256Gcm::new_from_slice(&sha256(format!("peekaview/key/v1:{secret}"))).expect("32 byte key"));
        let keypair = Keypair::from_secret_bytes(signing_key).unwrap_or_else(|_| Keypair::from_secret_bytes(new_signing_key()).expect("valid key"));
        let pubkey = hex(&keypair.x_only_public_key().0.to_byte_array());
        let (out, _) = broadcast::channel(64);
        let (in_tx, in_rx) = mpsc::unbounded_channel();
        let signaling = Signaling { topic, cipher, keypair, pubkey, out, recent: Arc::default(), stop: Arc::default() };
        let seen = Arc::new(Mutex::new(HashSet::new()));
        for url in relays {
            tauri::async_runtime::spawn(signaling.clone().relay(url.clone(), in_tx.clone(), seen.clone()));
        }
        (signaling, in_rx)
    }

    async fn relay(self, url: String, incoming: mpsc::UnboundedSender<Value>, seen: Arc<Mutex<HashSet<String>>>) {
        let mut backoff = Duration::from_secs(1);
        while !self.stop.load(std::sync::atomic::Ordering::Relaxed) {
            if let Ok((ws, _)) = tokio_tungstenite::connect_async(&url).await {
                backoff = Duration::from_secs(1);
                let (mut sink, mut stream) = ws.split();
                let req = json!(["REQ", format!("pv-{}", &self.topic[..8]), { "kinds": [KIND], "#t": [self.topic], "since": now() - 10 }]);
                if sink.send(Message::Text(req.to_string().into())).await.is_err() {
                    continue;
                }
                let mut out = self.out.subscribe();
                let backlog: Vec<String> = self.recent.lock().unwrap().iter().filter(|(t, _)| t.elapsed() < Duration::from_secs(10)).map(|(_, f)| f.clone()).collect();
                for frame in backlog {
                    let _ = sink.send(Message::Text(frame.into())).await;
                }
                loop {
                    tokio::select! {
                        msg = stream.next() => match msg {
                            Some(Ok(Message::Text(t))) => {
                                if let Some(msg) = self.receive(&t, &seen) {
                                    let _ = incoming.send(msg);
                                }
                            }
                            Some(Ok(Message::Ping(p))) => { let _ = sink.send(Message::Pong(p)).await; }
                            Some(Ok(_)) => {}
                            _ => break,
                        },
                        frame = out.recv() => match frame {
                            Ok(frame) => if sink.send(Message::Text(frame.into())).await.is_err() { break },
                            Err(broadcast::error::RecvError::Lagged(_)) => {}
                            Err(_) => break,
                        },
                    }
                    if self.stop.load(std::sync::atomic::Ordering::Relaxed) {
                        let _ = sink.close().await;
                        return;
                    }
                }
            }
            tokio::time::sleep(backoff).await;
            backoff = (backoff * 2).min(Duration::from_secs(30));
        }
    }

    fn receive(&self, frame: &str, seen: &Mutex<HashSet<String>>) -> Option<Value> {
        let v: Value = serde_json::from_str(frame).ok()?;
        if v[0] != "EVENT" {
            return None;
        }
        let event = &v[2];
        let id = event["id"].as_str()?.to_string();
        if event["pubkey"] == self.pubkey.as_str() || !seen.lock().unwrap().insert(id) {
            return None;
        }
        if (now() as i64 - event["created_at"].as_i64()?).abs() > 120 {
            return None;
        }
        // AES-GCM authenticates: anything not from this room fails here
        let raw = STANDARD.decode(event["content"].as_str()?).ok()?;
        if raw.len() < 13 {
            return None;
        }
        let plain = self.cipher.decrypt(Nonce::from_slice(&raw[..12]), &raw[12..]).ok()?;
        serde_json::from_slice(&plain).ok()
    }

    pub fn send(&self, msg: &Value) {
        let mut iv = [0u8; 12];
        getrandom::fill(&mut iv).expect("os random");
        let Ok(cipher) = self.cipher.encrypt(Nonce::from_slice(&iv), msg.to_string().as_bytes()) else { return };
        let content = STANDARD.encode([&iv[..], &cipher].concat());
        let created_at = now();
        let tags = json!([["t", self.topic]]);
        let id = sha256(json!([0, self.pubkey, created_at, KIND, tags, content]).to_string());
        let sig = schnorr::sign_no_aux_rand(&id, &self.keypair).to_byte_array();
        let event = json!({
            "id": hex(&id), "pubkey": self.pubkey, "created_at": created_at, "kind": KIND,
            "tags": tags, "content": content, "sig": hex(&sig),
        });
        let frame = json!(["EVENT", event]).to_string();
        {
            let mut recent = self.recent.lock().unwrap();
            recent.retain(|(t, _)| t.elapsed() < Duration::from_secs(10));
            recent.push_back((Instant::now(), frame.clone()));
        }
        let _ = self.out.send(frame);
    }

    pub fn close(&self) {
        self.stop.store(true, std::sync::atomic::Ordering::Relaxed);
        // wake the relay tasks
        let _ = self.out.send(json!(["CLOSE", format!("pv-{}", &self.topic[..8])]).to_string());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Round trip with a JS peer (web/signal.js) over the public relays:
    /// `PV_SECRET=… cargo test signal_interop -- --ignored` while `node echo.mjs …` runs.
    #[test]
    #[ignore]
    fn signal_interop() {
        let secret = std::env::var("PV_SECRET").expect("PV_SECRET");
        tauri::async_runtime::block_on(async {
            let relays: Vec<String> = DEFAULT_RELAYS.iter().map(|r| r.to_string()).collect();
            let (signaling, mut incoming) = Signaling::open(&secret, &relays, new_signing_key());
            tokio::time::sleep(Duration::from_secs(3)).await;
            signaling.send(&json!({ "type": "ping", "from": "rust", "n": 42 }));
            let reply = tokio::time::timeout(Duration::from_secs(15), async {
                loop {
                    let msg = incoming.recv().await.unwrap();
                    if msg["type"] == "pong" {
                        break msg;
                    }
                }
            })
            .await
            .expect("no pong from the JS peer");
            println!("rust got: {reply}");
            assert_eq!(reply["n"], 42);
            signaling.close();
        });
    }
}
