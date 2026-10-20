//! A sharing session: peer-to-peer hub, capture thread, control thread and the overlay window.

use std::sync::{
    atomic::{AtomicBool, AtomicU8, Ordering},
    mpsc as std_mpsc, Arc, Mutex,
};

use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};
use tokio::sync::mpsc;

use crate::{
    capture,
    recording::Recorder,
    resume,
    control::{self, Cmd},
    guard::Rect,
    p2p::{hub::Hub, signal, turn},
    video::{Source, Video},
    OVERLAY_TITLE,
};

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Mode {
    /// viewers only watch
    View = 0,
    /// viewers can point and draw
    Draw = 1,
    /// viewers can additionally control mouse and keyboard
    Control = 2,
}

impl Mode {
    pub fn as_str(self) -> &'static str {
        match self {
            Mode::View => "view",
            Mode::Draw => "draw",
            Mode::Control => "control",
        }
    }

    pub fn parse(s: &str) -> Option<Mode> {
        Some(match s {
            "view" => Mode::View,
            "draw" => Mode::Draw,
            "control" => Mode::Control,
            _ => return None,
        })
    }
}

/// State shared between the session threads.
pub struct Shared {
    mode: AtomicU8,
    pub stop: AtomicBool,
    pub need_key: AtomicBool,
    pub visible: AtomicBool,
    /// the shared window is in the foreground – remote control only works then
    pub foreground: AtomicBool,
    /// `Some(id)` when a single window is shared – input is then confined to it
    window_id: Mutex<Option<u32>>,
    /// a new source requested while sharing, taken over by the capture loop
    pub pending: Mutex<Option<(Source, std_mpsc::Sender<Result<(), String>>)>>,
    pub rect: Mutex<Rect>,
    pub recorder: Mutex<Option<Arc<Recorder>>>,
    /// last time remote control injected keys (to tell viewer and presenter typing apart)
    pub injected_at: Mutex<Option<std::time::Instant>>,
    /// (kind, title) of the shared source
    info: Mutex<(&'static str, String)>,
    /// messages for every viewer (state, own pointer)
    out: mpsc::UnboundedSender<String>,
}

impl Shared {
    pub fn mode(&self) -> Mode {
        match self.mode.load(Ordering::Relaxed) {
            1 => Mode::Draw,
            2 => Mode::Control,
            _ => Mode::View,
        }
    }

    pub fn window_id(&self) -> Option<u32> {
        *self.window_id.lock().unwrap()
    }

    pub fn send(&self, v: Value) {
        let _ = self.out.send(v.to_string());
    }

    pub fn state(&self) -> Value {
        let (kind, title) = self.info.lock().unwrap().clone();
        json!({
            "t": "state",
            "mode": self.mode().as_str(),
            "kind": kind,
            "title": title,
            "paused": !self.visible.load(Ordering::Relaxed),
            "foreground": self.foreground.load(Ordering::Relaxed),
            "recording": self.recorder.lock().unwrap().is_some(),
        })
    }

    pub fn recorder(&self) -> Option<Arc<Recorder>> {
        self.recorder.lock().unwrap().clone()
    }

    pub fn send_state(&self) {
        self.send(self.state());
    }
}

pub struct Session {
    shared: Arc<Shared>,
    ctrl: std_mpsc::Sender<Cmd>,
    source: Source,
    hub: Arc<Hub>,
}

/// Brings a shared window to the front (a shared screen needs nothing).
fn focus_source(source: &Source) {
    if let Source::Window(w) = source {
        if let (Ok(pid), Ok(id)) = (w.pid(), w.id()) {
            crate::focus::bring_to_front(pid, id);
        }
    }
}

#[derive(Default)]
pub struct SessionState(Mutex<Option<Session>>);

fn resolve(source: &str) -> Result<(Source, Option<u32>, &'static str, String), String> {
    let (kind, id) = source.split_once(':').ok_or("Ungültige Quelle")?;
    let id: u32 = id.parse().map_err(|_| "Ungültige Quelle")?;
    match kind {
        "screen" => {
            let m = xcap::Monitor::all()
                .map_err(|e| e.to_string())?
                .into_iter()
                .find(|m| m.id().ok() == Some(id))
                .ok_or("Bildschirm nicht gefunden")?;
            let title = m.friendly_name().or_else(|_| m.name()).unwrap_or_default();
            Ok((Source::Screen(m), None, "screen", title))
        }
        "window" => {
            let w = xcap::Window::all()
                .map_err(|e| e.to_string())?
                .into_iter()
                .find(|w| w.id().ok() == Some(id))
                .ok_or("Fenster nicht gefunden")?;
            let title = w.title().unwrap_or_default();
            Ok((Source::Window(w), Some(id), "window", title))
        }
        _ => Err("Ungültige Quelle".into()),
    }
}

#[derive(Clone)]
pub struct StartOptions {
    /// address of the static viewer website (for the link)
    pub site: String,
    pub name: String,
    pub source: String,
    /// room secret to share into (e.g. handed over by an integration); a new one otherwise
    pub room: Option<String>,
    pub color: Option<String>,
    pub relays: Vec<String>,
    /// ready-made ICE servers from an integration (with its own short-lived TURN credentials)
    pub ice: Option<Value>,
    /// TURN servers + coturn shared secret configured in this client
    pub turn_urls: Vec<String>,
    pub turn_secret: Option<String>,
    /// presenter key of a resumed room (hex), so existing links stay valid
    pub signing_key: Option<String>,
}

fn parse_key(hex: &str) -> Option<[u8; 32]> {
    let bytes: Vec<u8> = (0..hex.len()).step_by(2).filter_map(|i| u8::from_str_radix(hex.get(i..i + 2)?, 16).ok()).collect();
    bytes.try_into().ok()
}

fn valid_secret(s: &str) -> bool {
    (16..=64).contains(&s.len()) && s.chars().all(|c| c.is_ascii_alphanumeric() || "-_".contains(c))
}

/// Returns {room, link, ice}.
pub async fn start(app: AppHandle, opts: StartOptions) -> Result<Value, String> {
    stop(&app, None, false);
    let (source, window_id, kind, title) = resolve(&opts.source)?;
    let (rect, visible) = capture::geometry(&source).ok_or("Quelle nicht mehr vorhanden")?;
    let secret = opts.room.clone().filter(|r| valid_secret(r)).unwrap_or_else(signal::new_room_secret);
    let signing_key = opts.signing_key.as_deref().and_then(parse_key).unwrap_or_else(signal::new_signing_key);
    let key_hex: String = signing_key.iter().map(|b| format!("{b:02x}")).collect();
    let ice = opts.ice.clone().filter(Value::is_array).unwrap_or_else(|| turn::ice_servers(&opts.turn_urls, opts.turn_secret.as_deref(), "peekaview"));
    let relays: Vec<String> = if opts.relays.is_empty() { signal::DEFAULT_RELAYS.iter().map(|r| r.to_string()).collect() } else { opts.relays.clone() };

    let (out_tx, out_rx) = mpsc::unbounded_channel::<String>();
    let (frame_tx, frame_rx) = mpsc::channel::<Vec<u8>>(32);
    let shared = Arc::new(Shared {
        mode: AtomicU8::new(Mode::View as u8),
        stop: AtomicBool::new(false),
        need_key: AtomicBool::new(true),
        visible: AtomicBool::new(visible),
        foreground: AtomicBool::new(true),
        window_id: Mutex::new(window_id),
        pending: Mutex::new(None),
        rect: Mutex::new(rect),
        recorder: Mutex::new(None),
        injected_at: Mutex::new(None),
        info: Mutex::new((kind, title)),
        out: out_tx,
    });

    let video = Video::start(source.clone(), rect, shared.clone(), frame_tx.clone())?;
    create_overlay(&app).map_err(|e| e.to_string())?;
    to_overlay(&app, r#"{"t":"frame","live":true}"#);
    let ctrl = control::spawn(shared.clone());
    let host_color = opts.color.clone().unwrap_or_else(|| "#ffffff".into());
    let hub = Hub::start(app.clone(), shared.clone(), ctrl.clone(), &secret, signing_key, &relays, ice.clone(), (opts.name.clone(), host_color), out_rx, frame_rx);

    {
        let (app, shared, source) = (app.clone(), shared.clone(), source.clone());
        std::thread::spawn(move || capture::run(app, shared, source, video, frame_tx));
    }
    focus_source(&source);

    shared.send_state();
    resume::save(
        &app,
        json!({
            "site": opts.site, "name": opts.name, "source": opts.source, "room": secret, "color": opts.color,
            "relays": relays, "ice": opts.ice, "turn_urls": opts.turn_urls, "turn_secret": opts.turn_secret, "mode": "view",
            "signing_key": key_hex,
        }),
    );
    *app.state::<SessionState>().0.lock().unwrap() = Some(Session { shared, ctrl, source, hub });
    let site = opts.site.trim().trim_end_matches('/');
    // the presenter key after the "." lets viewers check who is presenting
    let room = format!("{secret}.{}", signal::public_key_b64(signing_key));
    Ok(json!({ "room": room, "link": format!("{site}/#{room}"), "ice": ice }))
}

/// The presenter's own handling of a (routed) message: overlay, remote control, recording, UI.
pub fn route_local(app: &AppHandle, shared: &Shared, ctrl: &std_mpsc::Sender<Cmd>, v: &Value) {
    let raw = v.to_string();
    let raw = raw.as_str();
    let annotations = shared.mode() != Mode::View;
    match v["t"].as_str().unwrap_or("") {
        "peers" => {
            if let Some(rec) = shared.recorder() {
                rec.set_peers(&v["list"]);
            }
            let _ = app.emit_to("main", "peers", &v["list"]);
            to_overlay(app, raw);
        }
        "ptr" => {
            if annotations {
                to_overlay(app, raw);
            }
            let _ = ctrl.send(Cmd::Input(v.clone()));
        }
        "draw" | "ping" | "clear" if annotations => {
            if let (Some(rec), "ping") = (shared.recorder(), v["t"].as_str().unwrap_or("")) {
                let from = v["from"].as_u64().unwrap_or(0);
                let pos = v["x"].as_f64().zip(v["y"].as_f64());
                rec.shot(format!("Zeigen – {}", rec.name(from)), pos);
            }
            to_overlay(app, raw);
        }
        "left" => {
            to_overlay(app, raw);
            let _ = ctrl.send(Cmd::Input(v.clone()));
        }
        "mouse" | "wheel" | "key" | "text" => {
            let _ = ctrl.send(Cmd::Input(v.clone()));
        }
        _ => {}
    }
}

/// Voice chat messages from the toolbar ({t:"voice"} / {t:"rtc"}) to the viewers.
pub fn signal(app: &AppHandle, msg: Value) {
    if !matches!(msg["t"].as_str(), Some("voice" | "rtc")) {
        return;
    }
    let hub = app.state::<SessionState>().0.lock().unwrap().as_ref().map(|s| s.hub.clone());
    if let Some(hub) = hub {
        tauri::async_runtime::spawn(async move { hub.from_host(msg).await });
    }
}

pub fn set_mode(app: &AppHandle, mode: Mode) {
    let guard = app.state::<SessionState>();
    let guard = guard.0.lock().unwrap();
    let Some(session) = guard.as_ref() else { return };
    session.shared.mode.store(mode as u8, Ordering::Relaxed);
    if mode != Mode::Control {
        let _ = session.ctrl.send(Cmd::Release);
    }
    let state = session.shared.state();
    to_overlay(app, &state.to_string());
    session.shared.send(state);
    resume::update(app, "mode", json!(mode.as_str()));
}

/// Switches the running share to another screen or window – room, viewers, voice and recording
/// continue. Blocks until the capture loop has taken over the new source.
pub fn switch_source(app: &AppHandle, source_id: &str) -> Result<Value, String> {
    let (source, window_id, kind, title) = resolve(source_id)?;
    let (reply_tx, reply_rx) = std_mpsc::channel();
    let shared = {
        let guard = app.state::<SessionState>();
        let guard = guard.0.lock().unwrap();
        let session = guard.as_ref().ok_or("Keine laufende Freigabe")?;
        let _ = session.ctrl.send(Cmd::Release);
        *session.shared.pending.lock().unwrap() = Some((source.clone(), reply_tx));
        session.shared.clone()
    };
    reply_rx.recv_timeout(std::time::Duration::from_secs(10)).map_err(|_| "Quellwechsel dauerte zu lange")??;

    *shared.window_id.lock().unwrap() = window_id;
    *shared.info.lock().unwrap() = (kind, title.clone());
    shared.foreground.store(true, Ordering::Relaxed);
    if let Some(rec) = shared.recorder() {
        rec.set_source(source.clone());
    }
    if let Some(session) = app.state::<SessionState>().0.lock().unwrap().as_mut() {
        session.source = source.clone();
    }
    shared.send_state();
    resume::update(app, "source", json!(source_id));
    focus_source(&source);
    Ok(json!({ "kind": kind, "title": title }))
}

/// Starts recording the running session.
pub fn start_recording(app: &AppHandle, opts: crate::recording::Options) -> Result<&'static str, String> {
    let guard = app.state::<SessionState>();
    let guard = guard.0.lock().unwrap();
    let session = guard.as_ref().ok_or("Keine laufende Freigabe")?;
    let rec = Recorder::new(session.source.clone(), opts);
    let label = rec.engine_label();
    *session.shared.recorder.lock().unwrap() = Some(rec);
    session.shared.send_state();
    to_overlay(app, r#"{"t":"frame","live":true,"recording":true}"#);
    Ok(label)
}

pub fn recording_audio(app: &AppHandle, bytes: &[u8]) {
    if let Some(rec) = app.state::<SessionState>().0.lock().unwrap().as_ref().and_then(|s| s.shared.recorder()) {
        rec.audio(bytes);
    }
}

/// Stops recording and writes the report (blocking). Returns its path.
pub fn stop_recording(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let rec = {
        let guard = app.state::<SessionState>();
        let guard = guard.0.lock().unwrap();
        let session = guard.as_ref().ok_or("Keine laufende Freigabe")?;
        let rec = session.shared.recorder.lock().unwrap().take().ok_or("Es läuft keine Aufzeichnung")?;
        session.shared.send_state();
        rec
    };
    to_overlay(app, r#"{"t":"frame","live":true,"recording":false}"#);
    rec.finish()
}

/// Shows the red frame around a source picked in the UI; `None` hides it.
pub fn highlight(app: &AppHandle, source: Option<&str>) {
    if app.state::<SessionState>().0.lock().unwrap().is_some() {
        return;
    }
    let geometry = source.and_then(|s| resolve(s).ok()).and_then(|(source, ..)| capture::geometry(&source));
    match geometry {
        Some((rect, visible)) => {
            if create_overlay(app).is_ok() {
                to_overlay(app, r#"{"t":"frame","live":false}"#);
                place_overlay(app, rect, visible);
            }
        }
        None => {
            if let Some(overlay) = app.get_webview_window("overlay") {
                let _ = overlay.hide();
            }
        }
    }
}

/// Ends the running session (if any). `reason` is shown in the main window. `forget` drops the
/// saved state; keep it for restarts so the share can continue afterwards. A running recording
/// is finished and its report announced to the toolbar.
pub fn stop(app: &AppHandle, reason: Option<&str>, forget: bool) {
    if forget {
        resume::clear(app);
    }
    let Some(session) = app.state::<SessionState>().0.lock().unwrap().take() else { return };
    if let Some(rec) = session.shared.recorder.lock().unwrap().take() {
        let app = app.clone();
        std::thread::spawn(move || {
            if let Ok(path) = rec.finish() {
                let _ = app.emit_to("main", "report", path.display().to_string());
                crate::open_path(&path);
            }
        });
    }
    session.shared.stop.store(true, Ordering::Relaxed);
    let _ = session.ctrl.send(Cmd::Release);
    session.hub.close();
    // the overlay window is kept for the next session, just hidden and wiped
    if let Some(overlay) = app.get_webview_window("overlay") {
        let _ = overlay.hide();
    }
    to_overlay(app, r#"{"t":"reset"}"#);
    let _ = app.emit_to("main", "ended", reason);
}

/// Quit / restart: finishes a running recording right away (the process is about to end), then
/// stops. `forget` = false keeps the saved state so the share continues after a restart.
pub fn shutdown(app: &AppHandle, forget: bool) {
    let rec = app.state::<SessionState>().0.lock().unwrap().as_ref().and_then(|s| s.shared.recorder.lock().unwrap().take());
    if let Some(rec) = rec {
        if let Ok(path) = rec.finish() {
            crate::open_path(&path);
        }
    }
    stop(app, None, forget);
}

/// Continues a share that was interrupted by a restart (e.g. after granting a permission).
pub async fn continue_after_restart(app: AppHandle) -> Result<Option<Value>, String> {
    let Some(saved) = resume::load(&app) else { return Ok(None) };
    if !crate::permissions::granted("screen") {
        return Ok(None); // keep it – the permission flow will restart the app again
    }
    let text = |k: &str| saved[k].as_str().map(str::to_string);
    let list = |k: &str| saved[k].as_array().map(|a| a.iter().filter_map(|v| v.as_str().map(str::to_string)).collect()).unwrap_or_default();
    let opts = StartOptions {
        site: text("site").unwrap_or_default(),
        name: text("name").unwrap_or_default(),
        source: text("source").unwrap_or_default(),
        room: text("room"),
        color: text("color"),
        relays: list("relays"),
        ice: Some(saved["ice"].clone()).filter(Value::is_array),
        turn_urls: list("turn_urls"),
        turn_secret: text("turn_secret"),
        signing_key: text("signing_key"),
    };
    match start(app.clone(), opts.clone()).await {
        Ok(mut hosted) => {
            let mode = text("mode").and_then(|m| Mode::parse(&m)).unwrap_or(Mode::View);
            set_mode(&app, mode);
            hosted["mode"] = json!(mode.as_str());
            hosted["source"] = json!(opts.source);
            hosted["site"] = json!(opts.site);
            Ok(Some(hosted))
        }
        Err(e) => {
            resume::clear(&app);
            Err(format!("Die Freigabe konnte nicht fortgesetzt werden: {e}"))
        }
    }
}

fn to_overlay(app: &AppHandle, raw: &str) {
    let _ = app.emit_to("overlay", "pv", raw);
}

fn create_overlay(app: &AppHandle) -> tauri::Result<()> {
    if app.get_webview_window("overlay").is_some() {
        return Ok(());
    }
    let overlay = WebviewWindowBuilder::new(app, "overlay", WebviewUrl::App("desktop/overlay.html".into()))
        .title(OVERLAY_TITLE)
        .transparent(true)
        .decorations(false)
        .shadow(false)
        .resizable(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .visible_on_all_workspaces(true)
        .focused(false)
        .focusable(false)
        // never part of any screen capture – neither ours nor e.g. a video call
        .content_protected(true)
        .visible(false)
        .build()?;
    overlay.set_ignore_cursor_events(true)?;
    // remember the overlay's window id: it covers the shared area but never blocks input
    #[cfg(target_os = "macos")]
    if let Ok(ns) = overlay.ns_window() {
        let ns = ns as usize;
        let _ = app.run_on_main_thread(move || {
            let id = unsafe { crate::macos::window_number(ns as *mut std::ffi::c_void) };
            crate::guard::OVERLAY_WINDOW.store(id, Ordering::Relaxed);
        });
    }
    Ok(())
}

pub fn place_overlay(app: &AppHandle, rect: Rect, visible: bool) {
    let Some(overlay) = app.get_webview_window("overlay") else { return };
    if !visible || rect.w <= 0 || rect.h <= 0 {
        let _ = overlay.hide();
        return;
    }
    // Overlay coordinates use the same space as xcap / enigo: points on macOS, pixels elsewhere.
    // Size first: Cocoa keeps the bottom-left corner when resizing, so resizing after
    // positioning would shift the window and cut off its bottom.
    #[cfg(target_os = "macos")]
    {
        let _ = overlay.set_size(tauri::LogicalSize::new(rect.w, rect.h));
        let _ = overlay.set_position(tauri::LogicalPosition::new(rect.x, rect.y));
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = overlay.set_size(tauri::PhysicalSize::new(rect.w as u32, rect.h as u32));
        let _ = overlay.set_position(tauri::PhysicalPosition::new(rect.x, rect.y));
    }
    let _ = overlay.show();
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Captures the primary display for two seconds through the real pipeline.
    /// Needs the screen recording permission: `cargo test -- --ignored --nocapture`
    /// (PV_DUMP=path writes the H.264 stream).
    #[test]
    #[ignore]
    fn live_capture_pipeline() {
        let monitor = xcap::Monitor::all().unwrap().into_iter().find(|m| m.is_primary().unwrap_or(false)).unwrap();
        let source = Source::Screen(monitor);
        let (rect, _) = capture::geometry(&source).unwrap();
        let (out, _out_rx) = mpsc::unbounded_channel();
        let shared = Arc::new(Shared {
            mode: AtomicU8::new(0),
            stop: AtomicBool::new(false),
            need_key: AtomicBool::new(true),
            visible: AtomicBool::new(true),
            foreground: AtomicBool::new(true),
            window_id: Mutex::new(None),
            pending: Mutex::new(None),
            rect: Mutex::new(rect),
            recorder: Mutex::new(None),
            injected_at: Mutex::new(None),
            info: Mutex::new(("screen", String::new())),
            out,
        });
        let (tx, mut rx) = mpsc::channel(256);
        let started = std::time::Instant::now();
        let mut video = Video::start(source, rect, shared.clone(), tx).expect("capture start");
        let mut packets = Vec::new();
        while started.elapsed() < std::time::Duration::from_secs(2) {
            video.tick();
            while let Ok(p) = rx.try_recv() {
                packets.push(p);
            }
            std::thread::sleep(std::time::Duration::from_millis(30));
        }
        drop(video);
        let first = packets.first().expect("no frames captured");
        let (w, h) = (u16::from_le_bytes([first[2], first[3]]), u16::from_le_bytes([first[4], first[5]]));
        println!("{} packets, {w}x{h}, first key={}, {} KB", packets.len(), first[1] & 1, packets.iter().map(|p| p.len()).sum::<usize>() / 1024);
        assert_eq!(first[1] & 1, 1, "stream must start with a keyframe");
        if let Ok(path) = std::env::var("PV_DUMP") {
            std::fs::write(path, packets.iter().flat_map(|p| p[6..].to_vec()).collect::<Vec<_>>()).unwrap();
        }
    }
}
