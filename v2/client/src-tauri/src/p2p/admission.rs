//! Who gets in: every viewer has to be let in by the presenter – or, in a room with a PIN, can
//! prove knowing it instead (challenge-response, the PIN never travels). Used by a running
//! share's hub and by permanent rooms waiting for remote access.

use std::{
    collections::{HashMap, HashSet},
    time::{Duration, Instant},
};

use serde_json::{json, Value};

use crate::rooms::{Pin, PIN_ROUNDS};

/// A request disappears when its viewer stops asking (closed the page).
/// (viewers repeat their hello at most every 10 s)
const REQUEST_TIMEOUT: Duration = Duration::from_secs(25);
/// Wrong PINs before a viewer is turned away / the PIN is locked for everybody for a while.
const TRIES_PER_VIEWER: u32 = 5;
const TRIES_PER_WINDOW: usize = 20;
const LOCK: Duration = Duration::from_secs(600);

struct Request {
    peer: String,
    hello: Value,
    seen: Instant,
    nonce: String,
}

pub enum Hello {
    /// let in already: connect
    Invite,
    Denied,
    /// waiting for the presenter; `new` = announce it; reply with this "waiting" message
    Waiting { new: bool, reply: Value },
}

pub enum PinResult {
    Ok(Value),
    Wrong { left: u32 },
    Locked,
}

pub struct Admission {
    pin: Option<Pin>,
    admitted: HashSet<String>,
    denied: HashSet<String>,
    requests: Vec<Request>,
    failures: HashMap<String, u32>,
    recent_failures: Vec<Instant>,
    locked_until: Option<Instant>,
}

impl Admission {
    pub fn new(pin: Option<Pin>, admitted: impl IntoIterator<Item = String>) -> Self {
        Admission {
            pin,
            admitted: admitted.into_iter().collect(),
            denied: HashSet::new(),
            requests: Vec::new(),
            failures: HashMap::new(),
            recent_failures: Vec::new(),
            locked_until: None,
        }
    }

    pub fn admitted(&self) -> Vec<String> {
        self.admitted.iter().cloned().collect()
    }

    pub fn hello(&mut self, peer: &str, hello: &Value) -> Hello {
        if self.admitted.contains(peer) {
            return Hello::Invite;
        }
        if self.denied.contains(peer) {
            return Hello::Denied;
        }
        let new = match self.requests.iter_mut().find(|r| r.peer == peer) {
            Some(r) => {
                r.seen = Instant::now();
                false
            }
            None => {
                self.requests.push(Request { peer: peer.to_string(), hello: hello.clone(), seen: Instant::now(), nonce: crate::clip::new_id() });
                true
            }
        };
        let nonce = self.requests.iter().find(|r| r.peer == peer).map(|r| r.nonce.clone()).unwrap_or_default();
        let mut reply = json!({ "type": "waiting", "from": "host", "to": peer });
        if let Some(pin) = &self.pin {
            reply["pin"] = json!({ "salt": pin.salt, "rounds": PIN_ROUNDS, "nonce": nonce });
        }
        Hello::Waiting { new, reply }
    }

    /// A viewer's answer to the PIN challenge.
    pub fn pin(&mut self, peer: &str, response: &str) -> PinResult {
        let Some(pin) = &self.pin else { return PinResult::Locked };
        if self.locked_until.is_some_and(|t| Instant::now() < t) {
            return PinResult::Locked;
        }
        let Some(i) = self.requests.iter().position(|r| r.peer == peer) else { return PinResult::Wrong { left: 0 } };
        if pin.verify(&self.requests[i].nonce, response) {
            let r = self.requests.remove(i);
            self.admitted.insert(r.peer);
            return PinResult::Ok(r.hello);
        }
        // a fresh challenge for the next try
        self.requests[i].nonce = crate::clip::new_id();
        let tries = self.failures.entry(peer.to_string()).or_default();
        *tries += 1;
        let left = TRIES_PER_VIEWER.saturating_sub(*tries);
        self.recent_failures.retain(|t| t.elapsed() < LOCK);
        self.recent_failures.push(Instant::now());
        if self.recent_failures.len() >= TRIES_PER_WINDOW {
            self.locked_until = Some(Instant::now() + LOCK);
        }
        if left == 0 {
            self.requests.remove(i);
            self.denied.insert(peer.to_string());
        }
        PinResult::Wrong { left }
    }

    /// The presenter's decision for one viewer, or (`None`) everybody waiting. Returns the
    /// hellos of the chosen ones.
    pub fn decide(&mut self, peer: Option<&str>, allow: bool) -> Vec<(String, Value)> {
        let (take, keep): (Vec<_>, Vec<_>) = self.requests.drain(..).partition(|r| peer.is_none_or(|p| r.peer == p));
        self.requests = keep;
        for r in &take {
            if allow {
                self.admitted.insert(r.peer.clone());
            } else {
                self.denied.insert(r.peer.clone());
            }
        }
        take.into_iter().map(|r| (r.peer, r.hello)).collect()
    }

    /// Drops requests of viewers that stopped asking; true if any were dropped.
    pub fn sweep(&mut self) -> bool {
        let before = self.requests.len();
        self.requests.retain(|r| r.seen.elapsed() < REQUEST_TIMEOUT);
        before != self.requests.len()
    }

    pub fn has_request(&self, peer: &str) -> bool {
        self.requests.iter().any(|r| r.peer == peer)
    }

    /// Open requests for the PeekaView window: [{peer, name, color}].
    pub fn requests(&self) -> Vec<Value> {
        self.requests
            .iter()
            .map(|r| {
                let name: String = r.hello["name"].as_str().unwrap_or("Gast").trim().chars().filter(|c| !c.is_control()).take(32).collect();
                json!({ "peer": r.peer, "name": if name.is_empty() { "Gast".to_string() } else { name }, "color": r.hello["color"] })
            })
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::{engine::general_purpose::STANDARD, Engine};
    use hmac::{Hmac, Mac};
    use sha2::Sha256;

    fn answer(pin: &Pin, nonce: &str) -> String {
        let mut mac = Hmac::<Sha256>::new_from_slice(&STANDARD.decode(&pin.key).unwrap()).unwrap();
        mac.update(nonce.as_bytes());
        mac.finalize().into_bytes().iter().map(|b| format!("{b:02x}")).collect()
    }

    #[test]
    fn approval_and_pin() {
        let pin = Pin::new("2468");
        let mut a = Admission::new(Some(pin.clone()), []);
        let Hello::Waiting { new: true, reply } = a.hello("p1", &json!({ "name": "Anna" })) else { panic!("should wait") };
        let nonce = reply["pin"]["nonce"].as_str().unwrap().to_string();
        assert!(matches!(a.hello("p1", &json!({})), Hello::Waiting { new: false, .. }));
        assert!(matches!(a.pin("p1", "00"), PinResult::Wrong { left: 4 }));
        // the challenge changed after the wrong try
        assert!(matches!(a.pin("p1", &answer(&pin, &nonce)), PinResult::Wrong { .. }));
        let Hello::Waiting { reply, .. } = a.hello("p1", &json!({})) else { panic!() };
        let fresh = reply["pin"]["nonce"].as_str().unwrap().to_string();
        assert!(matches!(a.pin("p1", &answer(&pin, &fresh)), PinResult::Ok(_)));
        assert!(matches!(a.hello("p1", &json!({})), Hello::Invite));
        // the presenter turns somebody away
        a.hello("p2", &json!({}));
        assert_eq!(a.decide(Some("p2"), false).len(), 1);
        assert!(matches!(a.hello("p2", &json!({})), Hello::Denied));
    }

    #[test]
    fn too_many_wrong_pins_turn_away() {
        let mut a = Admission::new(Some(Pin::new("1357")), []);
        a.hello("p", &json!({}));
        for _ in 0..TRIES_PER_VIEWER {
            a.pin("p", "00");
        }
        assert!(matches!(a.hello("p", &json!({})), Hello::Denied));
    }
}
