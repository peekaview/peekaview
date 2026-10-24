//! Local network access (macOS 15+): without the user's OK the app cannot reach other devices in
//! the network – a phone in the same Wi-Fi gets let in, but its connection never comes about.
//!
//! macOS has no API to ask for it or to check it. The first packet into the local network brings
//! up its prompt (with NSLocalNetworkUsageDescription from Info.plist), and such packets fail with
//! EHOSTUNREACH as long as access is not allowed. So right at the start one harmless datagram goes
//! to the discard port of a neighbour in the network, and from its result we know the state.

use std::{
    net::{IpAddr, Ipv4Addr, UdpSocket},
    sync::atomic::{AtomicU8, Ordering},
    time::Duration,
};

use tauri::{AppHandle, Emitter};

/// 0 = unknown (no local network, not macOS), 1 = allowed, 2 = not allowed
static STATE: AtomicU8 = AtomicU8::new(0);
/// errno of a packet macOS does not let into the local network
const EHOSTUNREACH: i32 = 65;

/// Whether this app may reach the local network: None when there is none to check.
fn probe() -> Option<bool> {
    // our own address in the network: the source of a route to the internet (a UDP connect
    // sends nothing)
    let route = UdpSocket::bind("0.0.0.0:0").ok()?;
    route.connect("1.1.1.1:9").ok()?;
    let IpAddr::V4(own) = route.local_addr().ok()?.ip() else { return None };
    if !own.is_private() {
        return None;
    }
    let o = own.octets();
    let neighbour = Ipv4Addr::new(o[0], o[1], o[2], if o[3] == 1 { 2 } else { 1 });
    let socket = UdpSocket::bind("0.0.0.0:0").ok()?;
    match socket.send_to(&[0], (neighbour, 9)) {
        Ok(_) => Some(true),
        Err(e) if e.raw_os_error() == Some(EHOSTUNREACH) => Some(false),
        // e.g. the neighbour does not exist (EHOSTDOWN): the packet was allowed out
        Err(_) => Some(true),
    }
}

/// The state now (probes again), `true` also when there is nothing to check.
pub fn allowed(app: &AppHandle) -> bool {
    update(app);
    STATE.load(Ordering::SeqCst) != 2
}

fn update(app: &AppHandle) {
    if !cfg!(target_os = "macos") {
        return;
    }
    let state = match probe() {
        Some(true) => 1,
        Some(false) => 2,
        None => 0,
    };
    if STATE.swap(state, Ordering::SeqCst) != state {
        crate::log(&format!("local network: {}", ["unknown", "allowed", "not allowed"][state as usize]));
        let _ = app.emit("local-network", state != 2);
    }
}

/// At the start: brings up macOS' prompt, then follows the answer for a while (the prompt, or the
/// switch in System Settings).
pub fn start(app: &AppHandle) {
    if !cfg!(target_os = "macos") {
        return;
    }
    let app = app.clone();
    std::thread::spawn(move || {
        update(&app);
        for _ in 0..150 {
            if STATE.load(Ordering::SeqCst) != 2 {
                return;
            }
            std::thread::sleep(Duration::from_secs(2));
            update(&app);
        }
    });
}

/// System Settings → Privacy & Security → Local Network.
pub fn open_settings() -> Result<(), String> {
    std::process::Command::new("open")
        .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_LocalNetwork")
        .status()
        .map_err(|e| e.to_string())
        .and_then(|s| if s.success() { Ok(()) } else { Err("Systemeinstellungen konnten nicht geöffnet werden.".into()) })
}
