//! Permanent rooms with remote access wait for viewers even while nothing is shared. A viewer
//! asking to join is let in by the presenter or with the room's PIN; then a share starts in that
//! room (remote control on, nothing shared yet) and the viewer picks what to start and share.

use std::{
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::Duration,
};

use serde_json::{json, Value};
use tauri::AppHandle;

use super::{
    admission::{Admission, Hello, PinResult},
    signal::{Signaling, DEFAULT_RELAYS},
};
use crate::{rooms::Room, session, settings};

pub struct Lobby {
    pub room: Room,
    signaling: Signaling,
    admission: Mutex<Admission>,
    stop: AtomicBool,
}

static LOBBIES: Mutex<Vec<Arc<Lobby>>> = Mutex::new(Vec::new());

fn relays(app: &AppHandle) -> Vec<String> {
    let list = settings::lines(app, "relays");
    if list.is_empty() {
        DEFAULT_RELAYS.iter().map(|r| r.to_string()).collect()
    } else {
        list
    }
}

/// Waiting rooms = permanent rooms with remote access that are not the running share's room.
/// `restart`: rooms changed (PIN, apps …) – start them afresh.
pub fn sync(app: &AppHandle, restart: bool) {
    let rooms: Vec<Room> = crate::rooms::all(app).into_iter().filter(|r| r.remote).collect();
    let active = session::active_secret(app);
    let mut lobbies = LOBBIES.lock().unwrap();
    lobbies.retain(|l| {
        let keep = !restart && active.as_deref() != Some(l.room.secret.as_str()) && rooms.iter().any(|r| r.id == l.room.id && r.secret == l.room.secret);
        if !keep {
            l.close();
        }
        keep
    });
    for room in rooms {
        if active.as_deref() == Some(room.secret.as_str()) || lobbies.iter().any(|l| l.room.id == room.id) {
            continue;
        }
        lobbies.push(Lobby::start(app, room));
    }
}

/// Open requests of all waiting rooms: [{peer, name, color, room}].
pub fn requests() -> Vec<Value> {
    LOBBIES
        .lock()
        .unwrap()
        .iter()
        .flat_map(|l| {
            l.admission.lock().unwrap().requests().into_iter().map(|mut r| {
                r["room"] = json!(l.room.name);
                r
            })
        })
        .collect()
}

/// The presenter's decision for a request waiting in one of the rooms (`None` = all of them).
pub fn admit(app: &AppHandle, peer: Option<&str>, allow: bool) {
    let lobbies = LOBBIES.lock().unwrap().clone();
    for lobby in lobbies {
        if peer.is_some_and(|p| !lobby.admission.lock().unwrap().has_request(p)) {
            continue;
        }
        let chosen = lobby.admission.lock().unwrap().decide(peer, allow);
        for (p, _) in chosen {
            if allow {
                // one remote session at a time: the first one let in starts it
                lobby.open(app, p);
                break;
            } else {
                lobby.signaling.send(&json!({ "type": "denied", "from": "host", "to": p }));
            }
        }
    }
    session::announce_requests(app);
}

impl Lobby {
    fn start(app: &AppHandle, room: Room) -> Arc<Lobby> {
        let key = session::parse_key(&room.key).unwrap_or_else(super::signal::new_signing_key);
        let (signaling, mut incoming) = Signaling::open(&room.secret, &relays(app), key);
        let lobby = Arc::new(Lobby { admission: Mutex::new(Admission::new(room.pin.clone(), [])), room, signaling, stop: AtomicBool::new(false) });
        crate::log(&format!("lobby: waiting in \"{}\"", lobby.room.name));
        let (me, app2) = (lobby.clone(), app.clone());
        tauri::async_runtime::spawn(async move {
            while let Some(msg) = incoming.recv().await {
                if me.stop.load(Ordering::Relaxed) {
                    break;
                }
                me.message(&app2, &msg);
            }
        });
        let (me, app2) = (lobby.clone(), app.clone());
        tauri::async_runtime::spawn(async move {
            while !me.stop.load(Ordering::Relaxed) {
                tokio::time::sleep(Duration::from_secs(3)).await;
                if me.admission.lock().unwrap().sweep() {
                    session::announce_requests(&app2);
                }
            }
        });
        lobby
    }

    fn close(&self) {
        self.stop.store(true, Ordering::Relaxed);
        self.signaling.close();
    }

    fn message(&self, app: &AppHandle, msg: &Value) {
        let from = msg["from"].as_str().unwrap_or_default().to_string();
        if from.is_empty() || from.len() > 64 {
            return;
        }
        match msg["type"].as_str() {
            Some("hello") => {
                if session::active_secret(app).is_some() {
                    // something else is being shared right now
                    self.signaling.send(&json!({ "type": "busy", "from": "host", "to": from }));
                    return;
                }
                let decision = self.admission.lock().unwrap().hello(&from, msg);
                match decision {
                    Hello::Invite => self.open(app, from),
                    Hello::Denied => self.signaling.send(&json!({ "type": "denied", "from": "host", "to": from })),
                    Hello::Waiting { new, reply } => {
                        self.signaling.send(&reply);
                        if new {
                            crate::log(&format!("lobby: join request in \"{}\"", self.room.name));
                            session::announce_requests(app);
                        }
                    }
                }
            }
            Some("pin") if msg["to"] == "host" => {
                let result = self.admission.lock().unwrap().pin(&from, msg["response"].as_str().unwrap_or(""));
                match result {
                    PinResult::Ok(_) => {
                        session::announce_requests(app);
                        self.open(app, from);
                    }
                    PinResult::Wrong { left } => {
                        self.signaling.send(&json!({ "type": "pin-wrong", "from": "host", "to": from, "left": left }));
                        if left == 0 {
                            session::announce_requests(app);
                        }
                    }
                    PinResult::Locked => self.signaling.send(&json!({ "type": "pin-wrong", "from": "host", "to": from, "locked": true })),
                }
            }
            _ => {}
        }
    }

    /// Starts the remote session in this room for a viewer that was let in.
    fn open(&self, app: &AppHandle, peer: String) {
        let (app, room) = (app.clone(), self.room.clone());
        tauri::async_runtime::spawn(async move {
            if let Err(e) = session::start_remote(&app, room, peer).await {
                crate::log(&format!("lobby: remote session failed: {e}"));
            }
        });
    }
}
