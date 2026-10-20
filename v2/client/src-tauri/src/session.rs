//! A sharing session: peer-to-peer hub, capture thread, control thread and the overlay windows.
//! One or several windows (or a screen) are shared at once; each is a [`Stream`] with its own
//! capture + encoder pipeline, video track slot and red frame.

use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicBool, AtomicU8, Ordering},
        mpsc as std_mpsc, Arc, Mutex,
    },
};

use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, EventTarget, Manager, WebviewUrl, WebviewWindowBuilder};
use tokio::sync::mpsc;

use crate::{
    capture,
    recording::Recorder,
    resume,
    control::{self, Cmd},
    guard::Rect,
    p2p::{admission::Admission, hub::Hub, lobby, signal, turn},
    rooms::Room,
    video::{Source, StreamCtl, Video, MAX_STREAMS},
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

/// One shared window or screen.
#[derive(Clone)]
pub struct Stream {
    /// video track slot (0..MAX_STREAMS) – also how viewers address it ("w")
    pub slot: u8,
    pub ctl: Arc<StreamCtl>,
    pub source: Source,
    /// source id from the picker ("window:123")
    pub id: String,
    /// `Some(id)` for a window: input is confined to it (and its own dialogs)
    pub window_id: Option<u32>,
    pub pid: Option<i32>,
    pub kind: &'static str,
    pub title: String,
    pub app: String,
    pub rect: Rect,
    /// some part of it is not covered – remote control is paused otherwise
    pub reachable: bool,
}

impl Stream {
    pub fn visible(&self) -> bool {
        self.ctl.visible.load(Ordering::Relaxed)
    }

    /// For the input guard: the window and its app (dialogs of the app count as part of it).
    pub fn target(&self) -> crate::guard::Target {
        self.window_id.map(|id| (id, self.pid.unwrap_or(-1)))
    }

    /// Normalized (0..1) coordinates of a screen point inside it.
    pub fn normalize(&self, x: i32, y: i32) -> (f64, f64) {
        ((x - self.rect.x) as f64 / self.rect.w.max(1) as f64, (y - self.rect.y) as f64 / self.rect.h.max(1) as f64)
    }
}

/// State shared between the session threads.
pub struct Shared {
    mode: AtomicU8,
    pub stop: AtomicBool,
    pub streams: Mutex<Vec<Stream>>,
    /// a new set of sources requested while sharing, taken over by the capture loop
    pub pending: Mutex<Option<(Vec<Stream>, std_mpsc::Sender<Result<(), String>>)>>,
    pub recorder: Mutex<Option<Arc<Recorder>>>,
    /// last time remote control injected keys (to tell viewer and presenter typing apart)
    pub injected_at: Mutex<Option<std::time::Instant>>,
    /// messages for every viewer (state, own pointer)
    out: mpsc::UnboundedSender<String>,
    /// the shared clipboard of this session
    pub clip: crate::clip::Store,
    /// room viewers have for a window (device pixels), for the "best size" button: id → (w, h)
    pub viewports: Mutex<HashMap<u32, (u32, u32)>>,
    /// room secret of this share
    pub secret: String,
    /// a remote session in a permanent room: viewers may start its applications
    pub remote: Option<Room>,
}

impl Shared {
    pub fn mode(&self) -> Mode {
        match self.mode.load(Ordering::Relaxed) {
            1 => Mode::Draw,
            2 => Mode::Control,
            _ => Mode::View,
        }
    }

    pub fn stream(&self, slot: u8) -> Option<Stream> {
        self.streams.lock().unwrap().iter().find(|s| s.slot == slot).cloned()
    }

    /// The stream a viewer message refers to (`"w": slot`; the first one if missing).
    pub fn stream_of(&self, v: &Value) -> Option<Stream> {
        let streams = self.streams.lock().unwrap();
        match v["w"].as_u64() {
            Some(slot) => streams.iter().find(|s| u64::from(s.slot) == slot).cloned(),
            None => streams.first().cloned(),
        }
    }

    /// Every pipeline sends a keyframe soon.
    pub fn request_key(&self) {
        for s in self.streams.lock().unwrap().iter() {
            s.ctl.need_key.store(true, Ordering::Relaxed);
        }
    }

    pub fn send(&self, v: Value) {
        let _ = self.out.send(v.to_string());
    }

    pub fn state(&self) -> Value {
        let streams = self.streams.lock().unwrap();
        let windows: Vec<Value> = streams
            .iter()
            .map(|s| {
                json!({
                    "w": s.slot, "kind": s.kind, "title": s.title, "app": s.app,
                    "paused": !s.visible(), "reachable": s.reachable,
                })
            })
            .collect();
        let first = streams.first();
        json!({
            "t": "state",
            "mode": self.mode().as_str(),
            "windows": windows,
            "kind": first.map(|s| s.kind).unwrap_or("screen"),
            "title": first.map(|s| if streams.len() > 1 { format!("{} Fenster", streams.len()) } else { s.title.clone() }).unwrap_or_default(),
            "paused": !streams.iter().any(Stream::visible),
            "reachable": streams.iter().any(|s| s.reachable),
            "recording": self.recorder.lock().unwrap().is_some(),
            // remote access: what viewers can start themselves
            "remote": self.remote.is_some(),
            "apps": self.remote.as_ref().map(Room::launchers).unwrap_or_default(),
            // viewers may resize, arrange and activate shared windows on this screen
            // (tray menu "Resize/Anordnen erlauben")
            "resize": crate::settings::allow_resize(),
        })
    }

    pub fn recorder(&self) -> Option<Arc<Recorder>> {
        self.recorder.lock().unwrap().clone()
    }

    pub fn send_state(&self) {
        self.send(self.state());
    }

    /// Remote control lacks the accessibility permission: ask the presenter (helper window).
    pub fn need_permission(&self) {
        let _ = self.out.send(json!({ "t": "need-permission" }).to_string());
    }
}

pub struct Session {
    shared: Arc<Shared>,
    ctrl: std_mpsc::Sender<Cmd>,
    hub: Arc<Hub>,
}

/// Brings all shared windows to the front, the first one last so it ends up on top (a shared
/// screen needs nothing).
fn focus_streams(streams: &[Stream]) {
    for s in streams.iter().rev() {
        if let (Some(pid), Some(id)) = (s.pid, s.window_id) {
            crate::focus::bring_to_front(pid as u32, id);
            // let the window server settle before the next app comes forward
            std::thread::sleep(std::time::Duration::from_millis(80));
        }
    }
}

#[derive(Default)]
pub struct SessionState(Mutex<Option<Session>>);

/// A source picked in the UI ("screen:1", "window:123") as a stream in `slot`.
fn open_stream(id: &str, slot: u8) -> Result<Stream, String> {
    let (kind, num) = id.split_once(':').ok_or("Ungültige Quelle")?;
    let num: u32 = num.parse().map_err(|_| "Ungültige Quelle")?;
    let (source, window_id, pid, kind, title, app) = match kind {
        "screen" => {
            let m = xcap::Monitor::all()
                .map_err(|e| e.to_string())?
                .into_iter()
                .find(|m| m.id().ok() == Some(num))
                .ok_or("Bildschirm nicht gefunden")?;
            let title = m.friendly_name().or_else(|_| m.name()).unwrap_or_default();
            (Source::Screen(m), None, None, "screen", title, String::new())
        }
        "window" => {
            let w = xcap::Window::all()
                .map_err(|e| e.to_string())?
                .into_iter()
                .find(|w| w.id().ok() == Some(num))
                .ok_or("Fenster nicht gefunden")?;
            let title = crate::sources::clean_name(&w.title().unwrap_or_default());
            let app = crate::sources::clean_name(&w.app_name().unwrap_or_default());
            let pid = w.pid().ok().map(|p| p as i32);
            (Source::Window(w), Some(num), pid, "window", title, app)
        }
        _ => return Err("Ungültige Quelle".into()),
    };
    let (rect, visible) = capture::geometry(&source).ok_or("Quelle nicht mehr vorhanden")?;
    Ok(Stream { slot, ctl: StreamCtl::new(slot, visible), source, id: id.to_string(), window_id, pid, kind, title, app, rect, reachable: true })
}

/// Picker ids → streams; ids already shared keep their slot (and running pipeline).
fn open_streams(ids: &[String], current: &[Stream]) -> Result<Vec<Stream>, String> {
    let mut ids: Vec<&String> = ids.iter().filter(|i| !i.is_empty()).collect();
    ids.dedup();
    if ids.is_empty() {
        return Err("Bitte ein Fenster oder einen Bildschirm wählen.".into());
    }
    if ids.len() > MAX_STREAMS {
        return Err(format!("Höchstens {MAX_STREAMS} Fenster gleichzeitig."));
    }
    let mut used: Vec<u8> = ids.iter().filter_map(|id| current.iter().find(|s| &s.id == *id).map(|s| s.slot)).collect();
    ids.iter()
        .map(|id| match current.iter().find(|s| &s.id == *id) {
            Some(s) => Ok(s.clone()),
            None => {
                let slot = (0..MAX_STREAMS as u8).find(|n| !used.contains(n)).ok_or("zu viele Fenster")?;
                used.push(slot);
                open_stream(id, slot)
            }
        })
        .collect()
}

#[derive(Clone)]
pub struct StartOptions {
    /// address of the static viewer website (for the link)
    pub site: String,
    pub name: String,
    /// one screen, or one or more windows ("screen:1", "window:123")
    pub sources: Vec<String>,
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
    /// viewers the presenter already let in (a share continued after a restart)
    pub admitted: Vec<String>,
    /// remote session in a permanent room (started by a viewer that was let in)
    pub remote: Option<Room>,
}

pub fn parse_key(hex: &str) -> Option<[u8; 32]> {
    let bytes: Vec<u8> = (0..hex.len()).step_by(2).filter_map(|i| u8::from_str_radix(hex.get(i..i + 2)?, 16).ok()).collect();
    bytes.try_into().ok()
}

fn valid_secret(s: &str) -> bool {
    (16..=64).contains(&s.len()) && s.chars().all(|c| c.is_ascii_alphanumeric() || "-_".contains(c))
}

/// Returns {room, link, ice, secret, signingKey}.
pub async fn start(app: AppHandle, opts: StartOptions) -> Result<Value, String> {
    stop(&app, None, false);
    // a remote session starts with nothing shared – the viewer picks what to start
    let streams = if opts.sources.is_empty() && opts.remote.is_some() { vec![] } else { open_streams(&opts.sources, &[])? };
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
        streams: Mutex::new(streams.clone()),
        pending: Mutex::new(None),
        recorder: Mutex::new(None),
        injected_at: Mutex::new(None),
        out: out_tx,
        clip: Default::default(),
        viewports: Mutex::default(),
        secret: secret.clone(),
        remote: opts.remote.clone(),
    });

    let mut videos = Vec::new();
    for s in &streams {
        videos.push((s.slot, Video::start(s.source.clone(), s.rect, s.ctl.clone(), frame_tx.clone())?));
        create_overlay(&app, s.slot).map_err(|e| e.to_string())?;
    }
    hide_overlays(&app, &streams);
    to_overlay(&app, r#"{"t":"frame","live":true}"#);
    let ctrl = control::spawn(shared.clone());
    let host_color = opts.color.clone().unwrap_or_else(|| "#ffffff".into());
    let hub = Hub::start(app.clone(), shared.clone(), ctrl.clone(), &secret, signing_key, &relays, ice.clone(), (opts.name.clone(), host_color), out_rx, frame_rx, Admission::new(crate::rooms::by_secret(&app, &secret).and_then(|r| r.pin), opts.admitted.clone()));

    {
        let (app, shared) = (app.clone(), shared.clone());
        std::thread::spawn(move || capture::run(app, shared, videos, frame_tx));
    }
    focus_streams(&streams);

    shared.send_state();
    resume::save(
        &app,
        json!({
            "site": opts.site, "name": opts.name, "sources": opts.sources, "room": secret, "color": opts.color,
            "relays": relays, "ice": opts.ice, "turn_urls": opts.turn_urls, "turn_secret": opts.turn_secret, "mode": "view",
            "signing_key": key_hex, "admitted": opts.admitted, "remote_room": opts.remote.as_ref().map(|r| r.id.clone()),
        }),
    );
    *app.state::<SessionState>().0.lock().unwrap() = Some(Session { shared, ctrl, hub });
    // a permanent room waiting for remote access is this share now
    lobby::sync(&app, false);
    // the viewer site: configured, or served over Nostr (nsite)
    let site = crate::nsite::resolve(&app, &opts.site);
    // the presenter key after the "." lets viewers check who is presenting
    let room = format!("{secret}.{}", signal::public_key_b64(signing_key));
    // secret + signing key let the UI keep the same link for the next share
    Ok(json!({ "room": room, "link": format!("{site}/#{room}"), "ice": ice, "secret": secret, "signingKey": key_hex }))
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
            *LAST_PEERS.lock().unwrap() = v["list"].clone();
            let _ = app.emit("peers", &v["list"]);
            to_overlay(app, raw);
        }
        "ptr" => {
            if annotations {
                to_overlay(app, raw);
            }
            let _ = ctrl.send(Cmd::Input(v.clone()));
        }
        "draw" | "ping" | "clear" | "hide" if annotations => {
            if let (Some(rec), "ping") = (shared.recorder(), v["t"].as_str().unwrap_or("")) {
                let from = v["from"].as_u64().unwrap_or(0);
                let pos = v["x"].as_f64().zip(v["y"].as_f64());
                if let Some(stream) = shared.stream_of(v) {
                    rec.set_source(stream.source);
                }
                rec.shot(format!("Zeigen – {}", rec.name(from)), pos);
            }
            to_overlay(app, raw);
        }
        "level" => to_overlay(app, raw),
        "left" => {
            to_overlay(app, raw);
            let _ = ctrl.send(Cmd::Input(v.clone()));
        }
        "mouse" | "wheel" | "key" | "text" | "copy" | "paste" => {
            let _ = ctrl.send(Cmd::Input(v.clone()));
        }
        _ => {}
    }
}

/// Voice chat messages from the toolbar ({t:"voice"} / {t:"rtc"} / {t:"level"}) to the viewers.
pub fn signal(app: &AppHandle, msg: Value) {
    if !matches!(msg["t"].as_str(), Some("voice" | "rtc" | "level")) {
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

/// Switches the running share to other windows / another screen – room, viewers, voice and
/// recording continue; windows that stay keep their pipeline. Blocks until the capture loop
/// has taken over.
pub fn switch_sources(app: &AppHandle, ids: &[String]) -> Result<Value, String> {
    let (reply_tx, reply_rx) = std_mpsc::channel();
    let streams = {
        let guard = app.state::<SessionState>();
        let guard = guard.0.lock().unwrap();
        let session = guard.as_ref().ok_or("Keine laufende Freigabe")?;
        let streams = open_streams(ids, &session.shared.streams.lock().unwrap())?;
        let _ = session.ctrl.send(Cmd::Release);
        *session.shared.pending.lock().unwrap() = Some((streams.clone(), reply_tx));
        streams
    };
    reply_rx.recv_timeout(std::time::Duration::from_secs(10)).map_err(|_| "Quellwechsel dauerte zu lange")??;
    resume::update(app, "sources", json!(ids));
    focus_streams(&streams);
    let titles: Vec<String> = streams.iter().map(|s| if s.kind == "window" && !s.app.is_empty() { format!("{} – {}", s.app, s.title) } else { s.title.clone() }).collect();
    Ok(json!({ "titles": titles }))
}

/// Starts recording the running session.
pub fn start_recording(app: &AppHandle, opts: crate::recording::Options) -> Result<&'static str, String> {
    let guard = app.state::<SessionState>();
    let guard = guard.0.lock().unwrap();
    let session = guard.as_ref().ok_or("Keine laufende Freigabe")?;
    let source = session.shared.streams.lock().unwrap().first().map(|s| s.source.clone()).ok_or("Keine Quelle")?;
    let rec = Recorder::new(source, opts);
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

/// Shows red frames around the sources picked in the UI; an empty list hides them.
pub fn highlight(app: &AppHandle, ids: &[String]) {
    if app.state::<SessionState>().0.lock().unwrap().is_some() {
        return;
    }
    let streams: Vec<Stream> = ids.iter().take(MAX_STREAMS).enumerate().filter_map(|(i, id)| open_stream(id, i as u8).ok()).collect();
    for s in &streams {
        if create_overlay(app, s.slot).is_ok() {
            place_overlay(app, s.slot, s.rect, s.visible());
        }
    }
    to_overlay(app, r#"{"t":"frame","live":false}"#);
    hide_overlays(app, &streams);
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
    // the shared clipboard ends with the share
    session.shared.clip.changed.notify_one();
    session.shared.clip.clear();
    if let Some(window) = app.get_webview_window("clipboard") {
        let _ = window.destroy();
    }
    // the overlay windows are kept for the next session, just hidden and wiped
    hide_overlays(app, &[]);
    to_overlay(app, r#"{"t":"reset"}"#);
    let _ = app.emit_to("main", "ended", reason);
    announce_requests(app);
    // permanent rooms with remote access wait again
    lobby::sync(app, false);
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
        sources: {
            let list: Vec<String> = list("sources");
            if list.is_empty() { text("source").into_iter().collect() } else { list }
        },
        room: text("room"),
        color: text("color"),
        relays: list("relays"),
        ice: Some(saved["ice"].clone()).filter(Value::is_array),
        turn_urls: list("turn_urls"),
        turn_secret: text("turn_secret"),
        signing_key: text("signing_key"),
        admitted: list("admitted"),
        remote: text("remote_room").and_then(|id| crate::rooms::get(&app, &id)),
    };
    match start(app.clone(), opts.clone()).await {
        Ok(mut hosted) => {
            let mode = text("mode").and_then(|m| Mode::parse(&m)).unwrap_or(Mode::View);
            set_mode(&app, mode);
            hosted["mode"] = json!(mode.as_str());
            hosted["sources"] = json!(opts.sources);
            hosted["site"] = json!(opts.site);
            Ok(Some(hosted))
        }
        Err(e) => {
            resume::clear(&app);
            Err(format!("Die Freigabe konnte nicht fortgesetzt werden: {e}"))
        }
    }
}

/// To every overlay window (each picks the messages of its own window, `"w"`).
pub fn to_overlay(app: &AppHandle, raw: &str) {
    let _ = app.emit_filter("pv", raw, |target| matches!(target, EventTarget::WebviewWindow { label } if label.starts_with("overlay-")));
}

fn overlay_label(slot: u8) -> String {
    format!("overlay-{slot}")
}

/// The click-through window with the red frame (and annotations) on top of a shared window.
fn create_overlay(app: &AppHandle, slot: u8) -> tauri::Result<()> {
    let label = overlay_label(slot);
    if app.get_webview_window(&label).is_some() {
        return Ok(());
    }
    let overlay = WebviewWindowBuilder::new(app, &label, WebviewUrl::App(format!("desktop/overlay.html?w={slot}").into()))
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
        // the badge's button works with the first click
        .accept_first_mouse(true)
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
            crate::guard::OVERLAY_WINDOWS.lock().unwrap().push(id);
        });
    }
    Ok(())
}

/// Hides the overlays of windows that are not (or no longer) shared.
fn hide_overlays(app: &AppHandle, keep: &[Stream]) {
    for (label, window) in app.webview_windows() {
        if label.starts_with("overlay-") && !keep.iter().any(|s| overlay_label(s.slot) == label) {
            let _ = window.hide();
        }
    }
}

pub fn place_overlay(app: &AppHandle, slot: u8, rect: Rect, visible: bool) {
    if create_overlay(app, slot).is_err() {
        return;
    }
    let Some(overlay) = app.get_webview_window(&overlay_label(slot)) else { return };
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

pub fn hide_overlay(app: &AppHandle, slot: u8) {
    if let Some(overlay) = app.get_webview_window(&overlay_label(slot)) {
        let _ = overlay.hide();
    }
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
        let (tx, mut rx) = mpsc::channel(256);
        let started = std::time::Instant::now();
        let mut video = Video::start(source, rect, StreamCtl::new(0, true), tx).expect("capture start");
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
        let (w, h) = (u16::from_le_bytes([first[3], first[4]]), u16::from_le_bytes([first[5], first[6]]));
        println!("{} packets, {w}x{h}, first key={}, {} KB", packets.len(), first[2] & 1, packets.iter().map(|p| p.len()).sum::<usize>() / 1024);
        assert_eq!(first[2] & 1, 1, "stream must start with a keyframe");
        if let Ok(path) = std::env::var("PV_DUMP") {
            std::fs::write(path, packets.iter().flat_map(|p| p[7..].to_vec()).collect::<Vec<_>>()).unwrap();
        }
    }
}

// ------------------------------------------------------------------ shared clipboard (presenter)

fn running(app: &AppHandle) -> Result<Arc<Shared>, String> {
    app.state::<SessionState>().0.lock().unwrap().as_ref().map(|s| s.shared.clone()).ok_or_else(|| "Keine laufende Freigabe".into())
}

/// Latest participant list (for windows opened later, e.g. the clipboard panel).
static LAST_PEERS: Mutex<Value> = Mutex::new(Value::Null);

pub fn peers() -> Value {
    LAST_PEERS.lock().unwrap().clone()
}

pub fn clip_list(app: &AppHandle) -> Vec<crate::clip::Meta> {
    running(app).map(|s| s.clip.list()).unwrap_or_default()
}

/// Files dropped onto the presenter's clipboard panel.
pub fn clip_add_paths(app: &AppHandle, paths: &[String]) -> Result<(), String> {
    let shared = running(app)?;
    let errors: Vec<String> = paths
        .iter()
        .filter_map(|p| {
            let path = std::path::Path::new(p);
            shared.clip.add_file(path, 0).err().map(|e| format!("{}: {e}", path.file_name().map(|n| n.to_string_lossy()).unwrap_or_default()))
        })
        .collect();
    shared.clip.changed.notify_one();
    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors.join("\n"))
    }
}

/// ⌘V / Ctrl+V in the presenter's clipboard panel: whatever is on the OS clipboard becomes an item.
pub fn clip_from_os(app: &AppHandle) -> Result<(), String> {
    use crate::clip::os::{read, Content};
    let shared = running(app)?;
    match read() {
        Content::Files(paths) => {
            for p in paths.iter().take(20) {
                shared.clip.add_file(p, 0)?;
            }
        }
        Content::Png(png) => {
            shared.clip.add_bytes("Bild.png", "image/png", &png, 0, false)?;
        }
        Content::Text { text, .. } => {
            shared.clip.add_bytes("Text.txt", "text/plain", text.as_bytes(), 0, false)?;
        }
        Content::Empty => return Err("Die Zwischenablage ist leer.".into()),
    }
    shared.clip.changed.notify_one();
    Ok(())
}

fn clip_item(app: &AppHandle, id: &str) -> Result<(crate::clip::Meta, std::path::PathBuf), String> {
    running(app)?.clip.get(id).ok_or_else(|| "Element nicht mehr vorhanden".into())
}

/// Bytes of an item (the panel renders PDF previews from them).
pub fn clip_read(app: &AppHandle, id: &str) -> Result<Vec<u8>, String> {
    let (_, path) = clip_item(app, id)?;
    std::fs::read(path).map_err(|e| e.to_string())
}

pub fn clip_set_preview(app: &AppHandle, id: &str, preview: &str) {
    if let Ok(shared) = running(app) {
        shared.clip.set_preview(id, preview);
        shared.clip.changed.notify_one();
    }
}

/// Onto the presenter's OS clipboard – files as files, images as images, text as text.
pub fn clip_copy(app: &AppHandle, id: &str) -> Result<(), String> {
    let (meta, path) = clip_item(app, id)?;
    crate::clip::os::write_item(&meta, &path)
}

pub fn clip_save(app: &AppHandle, id: &str) -> Result<String, String> {
    let (meta, path) = clip_item(app, id)?;
    crate::clip::save_to_downloads(&meta, &path).map(|p| p.display().to_string())
}

pub fn clip_remove(app: &AppHandle, id: &str) {
    if let Ok(shared) = running(app) {
        if shared.clip.remove(id, 0) {
            shared.clip.changed.notify_one();
        }
    }
}

/// Opens or closes the presenter's clipboard panel – a small window of its own that can be
/// dragged anywhere. Returns whether it is open now.
pub fn clip_window(app: &AppHandle, open: Option<bool>) -> Result<bool, String> {
    let existing = app.get_webview_window("clipboard");
    let open = open.unwrap_or(existing.is_none());
    match (existing, open) {
        (Some(window), false) => {
            let _ = window.destroy();
        }
        (None, true) => {
            running(app)?;
            let (w, h) = (384.0, 484.0);
            let mut builder = WebviewWindowBuilder::new(app, "clipboard", WebviewUrl::App("desktop/clipboard.html".into()))
                .title("PeekaView – Zwischenablage")
                .inner_size(w, h)
                .transparent(true)
                .decorations(false)
                .shadow(false)
                .resizable(false)
                .always_on_top(true)
                .skip_taskbar(true)
                .visible_on_all_workspaces(true);
            // below the toolbar, right-aligned with it
            if let Some(main) = app.get_webview_window("main") {
                if let (Ok(pos), Ok(size), Ok(scale)) = (main.outer_position(), main.outer_size(), main.scale_factor()) {
                    let x = (pos.x + size.width as i32) as f64 / scale - w;
                    let y = (pos.y + size.height as i32) as f64 / scale + 6.0;
                    builder = builder.position(x.max(0.0), y);
                }
            }
            let window = builder.build().map_err(|e| e.to_string())?;
            // keep it out of screen captures (macOS: the capture filter excludes our windows)
            #[cfg(not(target_os = "macos"))]
            let _ = window.set_content_protected(true);
            let _ = window;
        }
        _ => {}
    }
    let _ = app.emit_to("main", "clip-window", open);
    Ok(open)
}

// ------------------------------------------------------------------ best size for the viewers

/// Resizes a shared window on the presenter's screen so it fits the viewers' room 1:1 – one
/// picture pixel per screen pixel, so text stays sharp. Viewers report the room they have for
/// a window; the smallest one counts.
pub fn fit_window(app: &AppHandle, slot: u8) -> Result<(), String> {
    let shared = running(app)?;
    let (tw, th) = shared
        .viewports
        .lock()
        .unwrap()
        .values()
        .copied()
        .reduce(|a, b| (a.0.min(b.0), a.1.min(b.1)))
        .ok_or("Noch kein Zuschauer verbunden")?;
    set_window_pixels(app, slot, tw, th)
}

/// Gives a shared window the size at which its picture has `tw` × `th` pixels (or fits the
/// screen); it stays where it is as far as possible.
fn set_window_pixels(app: &AppHandle, slot: u8, tw: u32, th: u32) -> Result<(), String> {
    let shared = running(app)?;
    let stream = shared.stream(slot).ok_or("Fenster wird nicht mehr geteilt")?;
    let (Some(window_id), Some(pid)) = (stream.window_id, stream.pid) else {
        return Err("Nur für geteilte Fenster".into());
    };
    let r = stream.rect;
    let monitor = xcap::Monitor::from_point(r.x + r.w / 2, r.y + r.h / 2).map_err(|e| e.to_string())?;
    // window coordinates: points on macOS (pixels = points × scale), pixels elsewhere
    let scale = if cfg!(target_os = "macos") { monitor.scale_factor().unwrap_or(1.0) as f64 } else { 1.0 };
    let (mx, my) = (monitor.x().unwrap_or(0) as f64, monitor.y().unwrap_or(0) as f64);
    let (mw, mh) = (monitor.width().unwrap_or(0) as f64, monitor.height().unwrap_or(0) as f64);
    // the encoder's limit, then what fits on the presenter's screen (room for menu bar / taskbar)
    let (ew, eh) = crate::video::output_size(tw as f64, th as f64);
    let w = (ew as f64 / scale).min(mw).round();
    let h = (eh as f64 / scale).min(mh - 48.0).round();
    let x = (r.x as f64).clamp(mx, (mx + mw - w).max(mx));
    let y = (r.y as f64).clamp(my + 24.0, (my + mh - h).max(my + 24.0));
    if crate::focus::set_frame(pid as u32, window_id, x, y, w, h) {
        Ok(())
    } else {
        Err("Größe ließ sich nicht ändern – ist „Bedienungshilfen“ für PeekaView erlaubt?".into())
    }
}

/// The overlay's badge takes clicks while the presenter's pointer is over it (the rest of the
/// overlay stays click-through).
pub fn overlay_clickable(app: &AppHandle, slot: u8, on: bool) {
    if let Some(overlay) = app.get_webview_window(&overlay_label(slot)) {
        let _ = overlay.set_ignore_cursor_events(!on);
    }
}

// ------------------------------------------------------------------ admission across rooms

/// Room secret of the running share.
pub fn active_secret(app: &AppHandle) -> Option<String> {
    app.state::<SessionState>().0.lock().unwrap().as_ref().map(|s| s.shared.secret.clone())
}

/// All open join requests – of the running share and of permanent rooms waiting for remote
/// access – to the toolbar: [{peer, name, color, room?}].
pub fn announce_requests(app: &AppHandle) {
    let mut list = app.state::<SessionState>().0.lock().unwrap().as_ref().map(|s| s.hub.requests()).unwrap_or_default();
    list.extend(lobby::requests());
    let _ = app.emit_to("main", "join-requests", list);
}

/// Lets a waiting viewer in or turns them away; `peer: None` = everybody waiting.
pub fn admit(app: &AppHandle, peer: Option<String>, allow: bool) {
    let hub = app.state::<SessionState>().0.lock().unwrap().as_ref().map(|s| s.hub.clone());
    if let Some(hub) = hub.filter(|h| peer.as_deref().is_none_or(|p| h.has_request(p))) {
        tauri::async_runtime::spawn(hub.admit(peer.clone(), allow));
        if peer.is_some() {
            return;
        }
    }
    lobby::admit(app, peer.as_deref(), allow);
}

// ------------------------------------------------------------------ remote access

/// A viewer was let into a permanent room with remote access: share there (nothing yet, remote
/// control on) – the viewer starts what they need.
pub async fn start_remote(app: &AppHandle, room: Room, peer: String) -> Result<(), String> {
    if active_secret(app).is_some() {
        return Err("Es läuft schon eine Freigabe".into());
    }
    let site = crate::settings::text(app, "site").unwrap_or_default();
    let opts = StartOptions {
        site,
        name: crate::settings::text(app, "name").unwrap_or_else(|| "Host".into()),
        sources: vec![],
        room: Some(room.secret.clone()),
        color: None,
        relays: crate::settings::lines(app, "relays"),
        ice: None,
        turn_urls: crate::settings::lines(app, "turn_urls"),
        turn_secret: crate::settings::text(app, "turn_secret"),
        signing_key: Some(room.key.clone()),
        admitted: vec![peer],
        remote: Some(room.clone()),
    };
    let mut hosted = start(app.clone(), opts).await?;
    set_mode(app, Mode::Control);
    hosted["mode"] = json!("control");
    hosted["remote"] = json!(room.name);
    hosted["sources"] = json!([]);
    let _ = app.emit_to("main", "remote-started", hosted);
    Ok(())
}

/// A remote session without viewers ends after a while (the room waits again).
pub fn remote_viewers_gone(app: &AppHandle, shared: &Arc<Shared>) {
    if shared.remote.is_none() {
        return;
    }
    let (app, shared) = (app.clone(), shared.clone());
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_secs(60)).await;
        let current = app.state::<SessionState>().0.lock().unwrap().as_ref().map(|s| (s.shared.clone(), s.hub.viewer_count()));
        if let Some((current, 0)) = current {
            if Arc::ptr_eq(&current, &shared) {
                stop(&app, Some("Remote-Sitzung beendet – niemand mehr verbunden."), true);
            }
        }
    });
}

/// A remote viewer starts one of the room's applications (or the whole desktop); its window
/// joins the share.
pub fn launch(app: &AppHandle, id: &str) -> Result<(), String> {
    let shared = running(app)?;
    let room = shared.remote.clone().ok_or("Kein Remote-Zugriff")?;
    if id == "desktop" {
        if !room.desktop {
            return Err("Nicht freigegeben".into());
        }
        let monitor = xcap::Monitor::all().map_err(|e| e.to_string())?.into_iter().find(|m| m.is_primary().unwrap_or(false)).ok_or("Kein Bildschirm")?;
        return switch_sources(app, &[format!("screen:{}", monitor.id().map_err(|e| e.to_string())?)]).map(|_| ());
    }
    let entry = room.apps.iter().find(|a| a.id == id).ok_or("Anwendung nicht freigegeben")?.clone();
    let normal = crate::guard::normal_window_ids();
    let windows = || -> Vec<xcap::Window> {
        xcap::Window::all()
            .unwrap_or_default()
            .into_iter()
            .filter(|w| !w.is_minimized().unwrap_or(false))
            .filter(|w| w.width().unwrap_or(0) > 120 && w.height().unwrap_or(0) > 80)
            .filter(|w| w.pid().ok() != Some(std::process::id()))
            .filter(|w| normal.as_ref().is_none_or(|ids| w.id().ok().is_some_and(|id| ids.contains(&id))))
            .collect()
    };
    let before: Vec<u32> = windows().iter().filter_map(|w| w.id().ok()).collect();
    crate::rooms::launch(&entry.path)?;
    let started = std::time::Instant::now();
    let found = loop {
        std::thread::sleep(std::time::Duration::from_millis(300));
        let pids = crate::rooms::pids_of(&entry.path);
        let now = windows();
        // a new window of the app, or (it ran already) its frontmost window
        let new = now.iter().find(|w| w.id().is_ok_and(|id| !before.contains(&id)) && (pids.is_empty() || w.pid().is_ok_and(|p| pids.contains(&p))));
        let existing = (started.elapsed() > std::time::Duration::from_millis(2500)).then(|| now.iter().find(|w| w.pid().is_ok_and(|p| pids.contains(&p)))).flatten();
        if let Some(w) = new.or(existing) {
            break Some(w.id().map_err(|e| e.to_string())?);
        }
        if started.elapsed() > std::time::Duration::from_secs(15) {
            break None;
        }
    };
    let id = found.ok_or_else(|| format!("„{}“ hat kein Fenster geöffnet", entry.name))?;
    let mut ids: Vec<String> = shared.streams.lock().unwrap().iter().filter(|s| s.kind == "window").map(|s| s.id.clone()).collect();
    let new_id = format!("window:{id}");
    if !ids.contains(&new_id) {
        ids.push(new_id);
    }
    if ids.len() > MAX_STREAMS {
        ids.remove(0);
    }
    switch_sources(app, &ids).map(|_| ())
}

/// A viewer resized a window in their window manager ("Resize/Anordnen erlauben"): the window on this
/// screen follows, so it shows 1:1 there. `pw` × `ph` in the viewer's device pixels.
pub fn resize_window(app: &AppHandle, slot: u8, pw: u32, ph: u32) -> Result<(), String> {
    if !crate::settings::allow_resize() {
        return Err("Größe ändern ist nicht erlaubt".into());
    }
    set_window_pixels(app, slot, pw.clamp(200, 8192), ph.clamp(150, 8192))
}

/// Settings that viewers see changed (e.g. "Resize/Anordnen erlauben").
pub fn settings_changed(app: &AppHandle) {
    if let Ok(shared) = running(app) {
        shared.send_state();
    }
}

/// "Resize/Anordnen erlauben": a viewer activated a window in their window manager – it comes
/// to the front here, too.
pub fn activate_window(app: &AppHandle, slot: u8) -> Result<(), String> {
    if !crate::settings::allow_resize() {
        return Err("Nicht erlaubt".into());
    }
    let stream = running(app)?.stream(slot).ok_or("Fenster wird nicht mehr geteilt")?;
    if let (Some(pid), Some(id)) = (stream.pid, stream.window_id) {
        crate::focus::bring_to_front(pid as u32, id);
    }
    Ok(())
}

/// "Resize/Anordnen erlauben": a viewer moved a window in their window manager – it moves to the
/// same relative place on its screen here (`nx`, `ny`: top-left corner, 0..1 of the viewer's area).
pub fn arrange_window(app: &AppHandle, slot: u8, nx: f64, ny: f64) -> Result<(), String> {
    if !crate::settings::allow_resize() {
        return Err("Nicht erlaubt".into());
    }
    let stream = running(app)?.stream(slot).ok_or("Fenster wird nicht mehr geteilt")?;
    let (Some(window_id), Some(pid)) = (stream.window_id, stream.pid) else {
        return Err("Nur für geteilte Fenster".into());
    };
    let r = stream.rect;
    let monitor = xcap::Monitor::from_point(r.x + r.w / 2, r.y + r.h / 2).map_err(|e| e.to_string())?;
    let (mx, my) = (monitor.x().unwrap_or(0) as f64, monitor.y().unwrap_or(0) as f64);
    let (mw, mh) = (monitor.width().unwrap_or(0) as f64, monitor.height().unwrap_or(0) as f64);
    let (w, h) = (r.w as f64, r.h as f64);
    let x = (mx + nx.clamp(0.0, 1.0) * mw).clamp(mx, (mx + mw - w).max(mx));
    let y = (my + 24.0 + ny.clamp(0.0, 1.0) * (mh - 24.0)).clamp(my + 24.0, (my + mh - h).max(my + 24.0));
    if crate::focus::set_frame(pid as u32, window_id, x, y, w, h) {
        Ok(())
    } else {
        Err("Fenster ließ sich nicht verschieben – ist „Bedienungshilfen“ für PeekaView erlaubt?".into())
    }
}
