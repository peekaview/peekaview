//! `peekaview://share?room=<secret>&site=…&name=…&color=…&ice=<json>&relays=<json>` – lets an
//! integration (e.g. a video conference) open the desktop client prepared for its room. The user
//! still picks what to share.
//!
//! `peekaview://continue?room=<secret>&key=<presenter key, hex>&admitted=<viewer keys, comma
//! separated>&name=…&mode=view|draw` – a share running in the browser ("Bildschirmfreigabe
//! light", web/light-host.js) goes on here: the same room and presenter key (the link stays the
//! same) and the viewers it let in (nobody is asked again). The browser tab steps down once this
//! app is live in the room. Here, too, the user picks what to share and starts it – a link alone
//! never shares anything.

use std::sync::Mutex;

use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager};

#[derive(Default)]
pub struct PendingInvite(pub Mutex<Option<Value>>);

/// A browser lets in at most this many viewers (web/light-host.js).
const MAX_ADMITTED: usize = 12;

pub fn handle(app: &AppHandle, url: &tauri::Url) {
    let invite = match (url.scheme(), url.host_str()) {
        ("peekaview", Some("share")) => share(url),
        ("peekaview", Some("continue")) => handover(url),
        _ => None,
    };
    let Some(invite) = invite else { return };
    *app.state::<PendingInvite>().0.lock().unwrap() = Some(invite.clone());
    let _ = app.emit_to("main", "invite", invite);
    crate::show_main(app);
}

fn share(url: &tauri::Url) -> Option<Value> {
    let mut invite = json!({});
    for (key, value) in url.query_pairs() {
        match key.as_ref() {
            "site" | "room" | "name" | "color" => invite[key.as_ref()] = json!(value),
            // ready-made ICE servers (incl. short-lived TURN credentials) from an integration
            "ice" | "relays" => {
                if let Ok(v) = serde_json::from_str::<Value>(&value) {
                    invite[key.as_ref()] = v;
                }
            }
            _ => {}
        }
    }
    // a room is required; the viewer website must be http(s)
    if invite["room"].as_str().is_none_or(str::is_empty)
        || invite["site"].as_str().is_some_and(|s| !(s.starts_with("https://") || s.starts_with("http://")))
    {
        return None;
    }
    Some(invite)
}

fn hex_key(s: &str) -> bool {
    s.len() == 64 && s.bytes().all(|b| b.is_ascii_hexdigit())
}

/// `peekaview://continue?…` – everything checked, or nothing.
fn handover(url: &tauri::Url) -> Option<Value> {
    let get = |key: &str| url.query_pairs().find(|(k, _)| k == key).map(|(_, v)| v.into_owned());
    let room = get("room").filter(|r| crate::session::valid_secret(r))?;
    let key = get("key").map(|k| k.to_ascii_lowercase()).filter(|k| hex_key(k))?;
    let mut admitted: Vec<String> = Vec::new();
    for peer in get("admitted").unwrap_or_default().split(',').filter(|p| !p.is_empty()) {
        let peer = peer.to_ascii_lowercase();
        if !hex_key(&peer) {
            return None;
        }
        if !admitted.contains(&peer) {
            admitted.push(peer);
        }
    }
    if admitted.len() > MAX_ADMITTED {
        return None;
    }
    let name: String = get("name").unwrap_or_default().chars().filter(|c| !c.is_control()).take(32).collect();
    // remote control is never switched on by a link: the presenter does that here
    let mode = get("mode").filter(|m| m == "view" || m == "draw").unwrap_or_else(|| "view".into());
    Some(json!({
        "handover": true,
        "room": room,
        "signingKey": key,
        "admitted": admitted,
        "name": name.trim(),
        "mode": mode,
        // the browser's relays (signal.js DEFAULT_RELAYS): it has to hear this app take over
        "relays": [],
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    const KEY: &str = "4f3c2a1b0e9d8c7b6a5f4e3d2c1b0a99887766554433221100ffeeddccbbaa99";
    const VIEWER: &str = "aa11bb22cc33dd44ee55ff66778899aabbccddeeff00112233445566778899aa";

    fn parse(url: &str) -> Option<Value> {
        handover(&tauri::Url::parse(url).unwrap())
    }

    #[test]
    fn a_browser_share_goes_on_in_the_same_room_with_its_viewers() {
        let v = parse(&format!("peekaview://continue?room=AbCdEfGhIjKlMnOpQrStUv&key={KEY}&admitted={VIEWER}%2C{VIEWER}&name=Patrick&mode=draw")).unwrap();
        assert_eq!(v["handover"], true);
        assert_eq!(v["room"], "AbCdEfGhIjKlMnOpQrStUv");
        assert_eq!(v["signingKey"], KEY);
        assert_eq!(v["admitted"], json!([VIEWER]));
        assert_eq!(v["name"], "Patrick");
        assert_eq!(v["mode"], "draw");
        assert_eq!(v["relays"], json!([]));
        // nobody let in yet
        let v = parse(&format!("peekaview://continue?room=AbCdEfGhIjKlMnOpQrStUv&key={KEY}&admitted=")).unwrap();
        assert_eq!(v["admitted"], json!([]));
        assert_eq!(v["mode"], "view");
    }

    #[test]
    fn the_browser_s_key_gives_the_same_link_here() {
        // the presenter key of the viewer link, as the browser makes it (noble-schnorr, base64url)
        let key = crate::session::parse_key(KEY).unwrap();
        assert_eq!(crate::p2p::signal::public_key_b64(key), "0-O4DmlAwTcRSOAX8UJjx2aPEqV_SZV73NM5VGLJ6z8");
    }

    #[test]
    fn a_hand_over_never_switches_remote_control_on() {
        let v = parse(&format!("peekaview://continue?room=AbCdEfGhIjKlMnOpQrStUv&key={KEY}&mode=control")).unwrap();
        assert_eq!(v["mode"], "view");
    }

    #[test]
    fn broken_hand_overs_are_ignored() {
        // no key, a short key, a bad room, a bad viewer key, too many viewers
        assert!(parse("peekaview://continue?room=AbCdEfGhIjKlMnOpQrStUv").is_none());
        assert!(parse("peekaview://continue?room=AbCdEfGhIjKlMnOpQrStUv&key=abcd").is_none());
        assert!(parse(&format!("peekaview://continue?room=bad%20room&key={KEY}")).is_none());
        assert!(parse(&format!("peekaview://continue?room=AbCdEfGhIjKlMnOpQrStUv&key={KEY}&admitted=xyz")).is_none());
        let many: Vec<String> = (0..13).map(|i| format!("{i:064x}")).collect();
        assert!(parse(&format!("peekaview://continue?room=AbCdEfGhIjKlMnOpQrStUv&key={KEY}&admitted={}", many.join(","))).is_none());
    }
}
