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
/// Wrong PINs before a viewer is turned away. Across all viewers a permanent room locks after
/// [`MAX_FAILURES`](crate::pin_guard::MAX_FAILURES) until it is unlocked on this computer.
const TRIES_PER_VIEWER: u32 = 5;

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
    /// the room is locked after too many wrong PINs
    Locked,
    /// waiting for the presenter; `new` = announce it; reply with this "waiting" message
    Waiting { new: bool, reply: Value },
}

pub enum PinResult {
    Ok(Value),
    /// `wait`: seconds until the next try is taken
    Wrong { left: u32, wait: u64 },
    /// too soon after a wrong PIN – not checked, not counted
    Wait(u64),
    /// the room is locked (`now`: by this try)
    Locked { now: bool },
}

pub struct Admission {
    pin: Option<Pin>,
    admitted: HashSet<String>,
    /// a call over contacts: the members' devices, let in by the contacts server
    devices: HashSet<String>,
    denied: HashSet<String>,
    requests: Vec<Request>,
    failures: HashMap<String, u32>,
    /// the permanent room (id) whose wrong PINs count towards its lock
    room: Option<String>,
}

impl Admission {
    pub fn new(pin: Option<Pin>, admitted: impl IntoIterator<Item = String>) -> Self {
        Admission {
            pin,
            admitted: admitted.into_iter().collect(),
            devices: HashSet::new(),
            denied: HashSet::new(),
            requests: Vec::new(),
            failures: HashMap::new(),
            room: None,
        }
    }

    /// Wrong PINs count for this permanent room (see [`crate::pin_guard`]).
    pub fn for_room(mut self, room: Option<&str>) -> Self {
        self.room = room.map(str::to_string);
        self
    }

    fn room_locked(&self) -> bool {
        self.room.as_deref().is_some_and(crate::pin_guard::locked)
    }

    pub fn admitted(&self) -> Vec<String> {
        self.admitted.iter().cloned().collect()
    }

    /// Members of a call over contacts come in without asking: the viewer names its device.
    /// (A viewer's id is its key, unknown to the contacts server; only call members get the
    /// stream's secret, so only they can name a device here.)
    pub fn allow_devices(&mut self, devices: impl IntoIterator<Item = String>) {
        self.devices.extend(devices);
    }

    pub fn hello(&mut self, peer: &str, hello: &Value) -> Hello {
        // a locked room lets nobody in – not even viewers let in before
        if self.room_locked() {
            self.requests.retain(|r| r.peer != peer);
            return Hello::Locked;
        }
        if self.admitted.contains(peer) {
            return Hello::Invite;
        }
        if hello["device"].as_str().is_some_and(|d| self.devices.contains(d)) {
            self.admitted.insert(peer.to_string());
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
        let Some(pin) = &self.pin else { return PinResult::Wrong { left: 0, wait: 0 } };
        let room = self.room.clone();
        match room.as_deref().map(crate::pin_guard::gate) {
            Some(crate::pin_guard::Gate::Locked) => {
                self.requests.clear();
                return PinResult::Locked { now: false };
            }
            Some(crate::pin_guard::Gate::Wait(s)) => return PinResult::Wait(s),
            _ => {}
        }
        let Some(i) = self.requests.iter().position(|r| r.peer == peer) else { return PinResult::Wrong { left: 0, wait: 0 } };
        if pin.verify(&self.requests[i].nonce, response) {
            if let Some(room) = &room {
                crate::pin_guard::success(room);
            }
            let r = self.requests.remove(i);
            self.admitted.insert(r.peer);
            return PinResult::Ok(r.hello);
        }
        // a fresh challenge for the next try
        self.requests[i].nonce = crate::clip::new_id();
        let tries = self.failures.entry(peer.to_string()).or_default();
        *tries += 1;
        let mut left = TRIES_PER_VIEWER.saturating_sub(*tries);
        let mut wait = 0;
        if let Some(room) = &room {
            let f = crate::pin_guard::failure(room);
            if f.locked_now {
                // everybody waiting is turned away with the lock
                self.requests.clear();
                return PinResult::Locked { now: true };
            }
            left = left.min(f.left);
            wait = f.wait;
        }
        if left == 0 {
            self.requests.remove(i);
            self.denied.insert(peer.to_string());
        }
        PinResult::Wrong { left, wait }
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
        assert!(matches!(a.pin("p1", "00"), PinResult::Wrong { left: 4, wait: 0 }));
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

    #[test]
    fn room_locks_for_everybody_after_ten_wrong_pins() {
        crate::pin_guard::init_for_tests();
        let room = format!("room-{}", crate::clip::new_id());
        let pin = Pin::new("8642");
        // one room, several viewers (each turned away after its own 5 tries)
        let mut a = Admission::new(Some(pin.clone()), ["old".to_string()]).for_room(Some(&room));
        let mut locked = false;
        for v in 0..3 {
            let peer = format!("v{v}");
            for _ in 0..TRIES_PER_VIEWER {
                a.hello(&peer, &json!({}));
                // the waiting time between tries is not what this test is about
                crate::pin_guard::reset_wait_for_tests(&room);
                match a.pin(&peer, "00") {
                    PinResult::Wrong { .. } => {}
                    PinResult::Locked { now: true } => {
                        locked = true;
                        break;
                    }
                    _ => panic!("unexpected"),
                }
            }
            if locked {
                break;
            }
        }
        assert!(locked, "locked by the 10th wrong PIN");
        assert_eq!(crate::pin_guard::entry(&room).failures, crate::pin_guard::MAX_FAILURES);
        // nobody gets in: new viewers, viewers let in before, the right PIN
        assert!(matches!(a.hello("new", &json!({})), Hello::Locked));
        assert!(matches!(a.hello("old", &json!({})), Hello::Locked));
        assert!(matches!(a.pin("new", &answer(&pin, "x")), PinResult::Locked { now: false }));
        // a fresh admission (app restarted) still sees the lock
        let mut b = Admission::new(Some(pin.clone()), []).for_room(Some(&room));
        assert!(matches!(b.hello("p", &json!({})), Hello::Locked));
        // unlocked on this computer: the right PIN works again
        crate::pin_guard::reset(&room);
        let Hello::Waiting { reply, .. } = b.hello("p", &json!({})) else { panic!("should wait") };
        let nonce = reply["pin"]["nonce"].as_str().unwrap().to_string();
        assert!(matches!(b.pin("p", &answer(&pin, &nonce)), PinResult::Ok(_)));
    }

    #[test]
    fn wrong_pin_makes_the_next_try_wait() {
        crate::pin_guard::init_for_tests();
        let room = format!("room-{}", crate::clip::new_id());
        let mut a = Admission::new(Some(Pin::new("1111")), []).for_room(Some(&room));
        a.hello("p", &json!({}));
        assert!(matches!(a.pin("p", "00"), PinResult::Wrong { left: 4, wait: 1 }));
        assert!(matches!(a.pin("p", "00"), PinResult::Wait(1)));
        assert_eq!(crate::pin_guard::entry(&room).failures, 1, "a try while waiting does not count");
    }

    #[test]
    fn right_pin_resets_the_room_counter() {
        crate::pin_guard::init_for_tests();
        let room = format!("room-{}", crate::clip::new_id());
        let pin = Pin::new("2222");
        let mut a = Admission::new(Some(pin.clone()), []).for_room(Some(&room));
        a.hello("p", &json!({}));
        a.pin("p", "00");
        crate::pin_guard::reset_wait_for_tests(&room);
        let Hello::Waiting { reply, .. } = a.hello("p", &json!({})) else { panic!() };
        let nonce = reply["pin"]["nonce"].as_str().unwrap().to_string();
        assert!(matches!(a.pin("p", &answer(&pin, &nonce)), PinResult::Ok(_)));
        assert_eq!(crate::pin_guard::entry(&room).failures, 0);
    }

    #[test]
    fn call_members_by_device() {
        let mut a = Admission::new(None, []);
        a.allow_devices(["0123456789abcdef".to_string()]);
        assert!(matches!(a.hello("key-a", &json!({ "device": "0123456789abcdef" })), Hello::Invite));
        // from then on the key itself is let in
        assert!(matches!(a.hello("key-a", &json!({})), Hello::Invite));
        // another device asks first
        assert!(matches!(a.hello("key-b", &json!({ "device": "fedcba9876543210" })), Hello::Waiting { .. }));
    }
}
