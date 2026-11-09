//! The helper (`--helper`): waits in the links handed over to the service and shows the bar on
//! site while somebody is connected.
//! * Windows: SYSTEM process in the console session, started by the service.
//! * macOS: the LaunchAgent (login window: root; user session: that user). It gets the links from
//!   the daemon every few seconds and serves them only while its session is the one on the screen
//!   (fast user switching: the other sessions' agents keep still).

use std::time::Duration;

use serde_json::json;
use tauri::AppHandle;

use super::{log, store};

pub fn start(app: &AppHandle) {
    let links = store::get();
    crate::log(&format!("helper: {} links", links.rooms.len()));
    apply_settings(app, &links);
    crate::p2p::lobby::sync(app, false);
    let app = app.clone();
    std::thread::spawn(move || {
        #[cfg(target_os = "macos")]
        let mut next_links = std::time::Instant::now();
        let mut last_desk = "";
        loop {
            std::thread::sleep(Duration::from_millis(500));
            #[cfg(target_os = "macos")]
            if std::time::Instant::now() >= next_links {
                next_links = std::time::Instant::now() + Duration::from_secs(5);
                refresh_links(&app);
            }
            let names: Vec<String> = crate::session::peers()
                .as_array()
                .into_iter()
                .flatten()
                .filter(|p| p["host"] != true)
                .map(|p| p["name"].as_str().unwrap_or("Teilnehmer").to_string())
                .collect();
            let live = crate::session::running(&app).is_ok();
            // sign-in screen ↔ desktop ↔ locked: viewers see a hint
            let desk = crate::session::desk();
            if desk != last_desk {
                last_desk = desk;
                if let Ok(shared) = crate::session::running(&app) {
                    shared.send_state();
                }
            }
            #[cfg(target_os = "windows")]
            {
                super::indicator::set(if live { names } else { vec![] });
                if super::indicator::take_disconnect() && live {
                    disconnect_on_site(&app);
                }
            }
            #[cfg(target_os = "macos")]
            {
                super::mac::indicator::set(&app, if live { names } else { vec![] });
                if super::mac::indicator::take_disconnect() && live {
                    disconnect_on_site(&app);
                }
            }
            #[cfg(not(any(target_os = "windows", target_os = "macos")))]
            let _ = (names, live);
        }
    });
}

/// The helper's own settings (in memory only): name and relays from the store; no voice, no
/// transcript, no arranging of windows.
fn apply_settings(app: &AppHandle, links: &store::Store) {
    crate::settings::set(
        app,
        &json!({ "name": links.name, "relays": links.relays, "voice_enabled": false, "transcript_enabled": false, "allow_resize": false }),
    );
}

#[cfg_attr(not(any(target_os = "windows", target_os = "macos")), allow(dead_code))]
fn disconnect_on_site(app: &AppHandle) {
    let link = crate::session::running(app).ok().and_then(|s| s.remote.as_ref().map(|r| r.name.clone())).unwrap_or_default();
    log::event(&link, "–", "vor Ort getrennt");
    crate::session::stop(app, Some("Vor Ort getrennt."), true);
}

/// Whether this agent serves the links: only for the session on the screen.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub fn serves(on_console: bool, links: store::Store) -> store::Store {
    if on_console {
        links
    } else {
        store::Store::default()
    }
}

/// macOS: the links from the daemon (none while the session is not on screen, or the daemon is
/// gone); waiting rooms start afresh when they changed.
#[cfg(target_os = "macos")]
fn refresh_links(app: &AppHandle) {
    let on_console = super::mac::console::current().on_console;
    let links = if on_console {
        super::mac::client::links().unwrap_or_else(|e| {
            crate::log(&format!("helper: no links from the daemon: {e}"));
            store::Store::default()
        })
    } else {
        store::Store::default()
    };
    let links = serves(on_console, links);
    if store::set(links.clone()) {
        crate::log(&format!("helper: {} links (on screen: {on_console})", links.rooms.len()));
        apply_settings(app, &links);
        // a running share through a link that is gone ends
        if let Ok(shared) = crate::session::running(app) {
            let gone = shared.remote.as_ref().is_some_and(|r| !links.rooms.iter().any(|l| l.id == r.id && l.secret == r.secret));
            if gone {
                crate::session::stop(app, Some("Der Link wird hier nicht mehr bedient."), true);
            }
        }
        crate::p2p::lobby::sync(app, true);
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn only_the_session_on_screen_serves() {
        let links = super::store::Store { name: "Mac".into(), relays: vec![], rooms: vec![] };
        assert_eq!(super::serves(true, links.clone()).name, "Mac");
        assert_eq!(super::serves(false, links).name, "", "another user's session keeps still");
    }
}
