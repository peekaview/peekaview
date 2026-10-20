//! The presenter is the hub of a star of peer-to-peer WebRTC connections – one per viewer, each
//! carrying one H.264 video track per shared-window slot, a data channel ("pv") and a second one for the shared
//! clipboard's files ("pvfile", so big transfers never hold up pointers and input). It takes over
//! what a relay server would do: participant list, colors, routing by mode, the clipboard store
//! and voice-chat signaling between viewers.

use std::{
    collections::{HashMap, HashSet},
    io::Read,
    sync::{
        atomic::{AtomicU32, Ordering},
        mpsc as std_mpsc, Arc, Mutex,
    },
    time::{Duration, Instant},
};

use bytes::{Bytes, BytesMut};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};
use tokio::sync::mpsc;
use webrtc::{
    data_channel::{DataChannel, DataChannelEvent, RTCDataChannelInit},
    media_stream::{track_local::static_sample::TrackLocalStaticSample, track_local::TrackLocal},
    peer_connection::{PeerConnection, PeerConnectionBuilder, PeerConnectionEventHandler, RTCPeerConnectionState},
    rtp_transceiver::RtpSender,
};
use rtc::{
    interceptor::Registry,
    media::Sample,
    media_stream::MediaStreamTrack,
    peer_connection::{
        configuration::{interceptor_registry::register_default_interceptors, media_engine::{MediaEngine, MIME_TYPE_H264}, RTCConfigurationBuilder},
        event::RTCPeerConnectionIceEvent,
        sdp::RTCSessionDescription,
        transport::{RTCIceCandidateInit, RTCIceServer},
    },
    rtp_transceiver::rtp_sender::{RTCRtpCodec, RTCRtpCodecParameters, RTCRtpCodingParameters, RTCRtpEncodingParameters, RtpCodecKind},
};

use super::{
    admission::{Admission, Hello, PinResult},
    signal::Signaling,
};
use crate::{
    control::Cmd,
    clip::Meta,
    session::{self, Mode, Shared},
};

/// Clipboard file chunks: small enough for every browser's data channel.
const CHUNK: usize = 16 * 1024;
/// Data a viewer's channel may buffer before sending waits (back-pressure for big files).
const SEND_BUFFER: usize = 4 << 20;

const COLORS: [&str; 10] = [
    "#ef4444", "#f97316", "#eab308", "#22c55e", "#14b8a6", "#06b6d4", "#3b82f6", "#8b5cf6", "#d946ef", "#ec4899",
];
const H264_FMTP: &str = "level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f";
const MAX_VIEWERS: usize = 12;

fn h264() -> RTCRtpCodec {
    RTCRtpCodec { mime_type: MIME_TYPE_H264.to_owned(), clock_rate: 90000, channels: 0, sdp_fmtp_line: H264_FMTP.to_owned(), rtcp_feedback: vec![] }
}

struct OutTrack {
    track: Arc<TrackLocalStaticSample>,
    sender: Arc<dyn RtpSender>,
    ssrc: u32,
    payload_type: Option<u8>,
}

struct Viewer {
    peer: String,
    name: String,
    color: String,
    voice: bool,
    pc: Arc<dyn PeerConnection>,
    dc: Option<Arc<dyn DataChannel>>,
    /// clipboard previews this viewer already has (they are sent once, separately)
    previews: HashSet<String>,
    /// one video track per shared-window slot (`video::MAX_STREAMS`): a window joining or leaving
    /// only changes which slot carries what, the connection is never renegotiated
    tracks: Vec<OutTrack>,
    /// remote ICE candidates that arrived before the answer
    pending: Vec<RTCIceCandidateInit>,
    answered: bool,
}

pub struct Hub {
    app: AppHandle,
    shared: Arc<Shared>,
    ctrl: std_mpsc::Sender<Cmd>,
    signaling: Signaling,
    ice: Vec<RTCIceServer>,
    ice_json: Value,
    host: Mutex<(String, String, bool)>,
    viewers: Mutex<HashMap<u32, Viewer>>,
    next_id: AtomicU32,
    /// nobody gets in without the presenter's OK (or the room's PIN)
    admission: Mutex<Admission>,
    asked_permission: Mutex<Option<Instant>>,
}

struct Events {
    hub: Arc<Hub>,
    id: u32,
    peer: String,
}

#[async_trait::async_trait]
impl PeerConnectionEventHandler for Events {
    /// trickle ICE: every local candidate goes out as soon as it is found
    async fn on_ice_candidate(&self, event: RTCPeerConnectionIceEvent) {
        if let Ok(init) = event.candidate.to_json() {
            self.hub.signaling.send(&json!({ "type": "candidate", "from": "host", "to": self.peer, "id": self.id, "candidate": init }));
        }
    }

    async fn on_connection_state_change(&self, state: RTCPeerConnectionState) {
        crate::log(&format!("p2p: viewer {} {state}", self.id));
        match state {
            RTCPeerConnectionState::Connected => {
                self.hub.connected(self.id).await;
            }
            RTCPeerConnectionState::Failed | RTCPeerConnectionState::Closed => self.hub.remove(self.id).await,
            _ => {}
        }
    }
}

impl Hub {
    pub fn start(
        app: AppHandle,
        shared: Arc<Shared>,
        ctrl: std_mpsc::Sender<Cmd>,
        secret: &str,
        signing_key: [u8; 32],
        relays: &[String],
        ice: Value,
        host: (String, String),
        out: mpsc::UnboundedReceiver<String>,
        frames: mpsc::Receiver<Vec<u8>>,
        admission: Admission,
    ) -> Arc<Hub> {
        let (signaling, incoming) = Signaling::open(secret, relays, signing_key);
        let ice_servers = ice
            .as_array()
            .into_iter()
            .flatten()
            .map(|s| RTCIceServer {
                urls: match &s["urls"] {
                    Value::String(u) => vec![u.clone()],
                    Value::Array(a) => a.iter().filter_map(|u| u.as_str().map(str::to_string)).collect(),
                    _ => vec![],
                },
                username: s["username"].as_str().unwrap_or_default().to_string(),
                credential: s["credential"].as_str().unwrap_or_default().to_string(),
            })
            .collect();
        let hub = Arc::new(Hub {
            app,
            shared,
            ctrl,
            signaling,
            ice: ice_servers,
            ice_json: ice,
            host: Mutex::new((host.0, host.1, false)),
            viewers: Mutex::default(),
            next_id: AtomicU32::new(1),
            admission: Mutex::new(admission),
            asked_permission: Mutex::new(None),
        });
        tauri::async_runtime::spawn(hub.clone().signals(incoming));
        tauri::async_runtime::spawn(hub.clone().outgoing(out));
        tauri::async_runtime::spawn(hub.clone().video(frames));
        tauri::async_runtime::spawn(hub.clone().clip_changes());
        // viewers already waiting answer right away
        hub.signaling.send(&json!({ "type": "host" }));
        let beacon = hub.clone();
        tauri::async_runtime::spawn(async move {
            while !beacon.shared.stop.load(Ordering::Relaxed) {
                tokio::time::sleep(Duration::from_secs(15)).await;
                beacon.signaling.send(&json!({ "type": "host" }));
            }
        });
        let sweeper = hub.clone();
        tauri::async_runtime::spawn(async move {
            while !sweeper.shared.stop.load(Ordering::Relaxed) {
                tokio::time::sleep(Duration::from_secs(3)).await;
                if sweeper.admission.lock().unwrap().sweep() {
                    session::announce_requests(&sweeper.app);
                }
            }
        });
        hub
    }

    pub fn close(&self) {
        let pcs: Vec<_> = self.viewers.lock().unwrap().drain().map(|(_, v)| (v.pc, v.dc)).collect();
        tauri::async_runtime::spawn(async move {
            for (pc, dc) in pcs {
                if let Some(dc) = dc {
                    let _ = dc.send_text(&json!({ "t": "end" }).to_string()).await;
                }
                let _ = pc.close().await;
            }
        });
        self.signaling.send(&json!({ "type": "bye", "from": "host" }));
        self.signaling.close();
    }

    // ------------------------------------------------------------------ signaling

    async fn signals(self: Arc<Self>, mut incoming: mpsc::UnboundedReceiver<Value>) {
        while let Some(msg) = incoming.recv().await {
            if self.shared.stop.load(Ordering::Relaxed) {
                break;
            }
            let from = msg["from"].as_str().unwrap_or_default().to_string();
            match msg["type"].as_str() {
                Some("hello") if !from.is_empty() && from.len() <= 64 => {
                    let known = self.viewers.lock().unwrap().values().any(|v| v.peer == from);
                    if known {
                        continue;
                    }
                    let decision = self.admission.lock().unwrap().hello(&from, &msg);
                    match decision {
                        Hello::Invite => {
                            if let Err(e) = self.clone().invite(from, &msg).await {
                                crate::log(&format!("p2p: invite failed: {e}"));
                            }
                        }
                        Hello::Denied => self.signaling.send(&json!({ "type": "denied", "from": "host", "to": from })),
                        // the presenter decides (or the viewer enters the room's PIN)
                        Hello::Waiting { new, reply } => {
                            self.signaling.send(&reply);
                            if new {
                                crate::log("p2p: join request");
                                session::announce_requests(&self.app);
                            }
                        }
                    }
                }
                Some("pin") if msg["to"] == "host" && !from.is_empty() => {
                    let result = self.admission.lock().unwrap().pin(&from, msg["response"].as_str().unwrap_or(""));
                    match result {
                        PinResult::Ok(hello) => {
                            session::announce_requests(&self.app);
                            self.remember_admitted();
                            if let Err(e) = self.clone().invite(from, &hello).await {
                                crate::log(&format!("p2p: invite failed: {e}"));
                            }
                        }
                        PinResult::Wrong { left } => {
                            self.signaling.send(&json!({ "type": "pin-wrong", "from": "host", "to": from, "left": left }));
                            if left == 0 {
                                session::announce_requests(&self.app);
                            }
                        }
                        PinResult::Locked => self.signaling.send(&json!({ "type": "pin-wrong", "from": "host", "to": from, "locked": true })),
                    }
                }
                Some("answer") if msg["to"] == "host" => {
                    crate::log("p2p: answer received");
                    let pc = self.viewers.lock().unwrap().values().find(|v| v.peer == from).map(|v| v.pc.clone());
                    if let (Some(pc), Ok(sdp)) = (pc, serde_json::from_value::<RTCSessionDescription>(msg["sdp"].clone())) {
                        if let Err(e) = pc.set_remote_description(sdp).await {
                            crate::log(&format!("p2p: answer rejected: {e}"));
                        }
                        let pending = match self.viewers.lock().unwrap().values_mut().find(|v| v.peer == from) {
                            Some(v) => {
                                v.answered = true;
                                std::mem::take(&mut v.pending)
                            }
                            None => vec![],
                        };
                        for candidate in pending {
                            let _ = pc.add_ice_candidate(candidate).await;
                        }
                    }
                }
                Some("candidate") if msg["to"] == "host" => {
                    let Ok(candidate) = serde_json::from_value::<RTCIceCandidateInit>(msg["candidate"].clone()) else { continue };
                    let ready = {
                        let mut viewers = self.viewers.lock().unwrap();
                        match viewers.values_mut().find(|v| v.peer == from) {
                            Some(v) if v.answered => Some(v.pc.clone()),
                            Some(v) => {
                                v.pending.push(candidate.clone());
                                None
                            }
                            None => None,
                        }
                    };
                    if let Some(pc) = ready {
                        let _ = pc.add_ice_candidate(candidate).await;
                    }
                }
                Some("bye") => {
                    let id = self.viewers.lock().unwrap().iter().find(|(_, v)| v.peer == from).map(|(id, _)| *id);
                    if let Some(id) = id {
                        self.remove(id).await;
                    }
                }
                _ => {}
            }
        }
    }

    /// A viewer said hello: build a connection and send it the offer.
    async fn invite(self: Arc<Self>, peer: String, hello: &Value) -> Result<(), String> {
        crate::log("p2p: hello received");
        if self.viewers.lock().unwrap().len() >= MAX_VIEWERS {
            return Err("room full".into());
        }
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let name: String = hello["name"].as_str().unwrap_or("Gast").trim().chars().filter(|c| !c.is_control()).take(32).collect();
        let color = hello["color"]
            .as_str()
            .filter(|c| c.len() == 7 && c.starts_with('#') && c[1..].chars().all(|c| c.is_ascii_hexdigit()))
            .map(str::to_lowercase)
            .unwrap_or_else(|| COLORS[(id as usize - 1) % COLORS.len()].to_string());

        let mut media = MediaEngine::default();
        media
            .register_codec(RTCRtpCodecParameters { rtp_codec: h264(), payload_type: 102, ..Default::default() }, RtpCodecKind::Video)
            .map_err(|e| e.to_string())?;
        let registry = register_default_interceptors(Registry::new(), &mut media).map_err(|e| e.to_string())?;
        let pc = PeerConnectionBuilder::new()
            .with_configuration(RTCConfigurationBuilder::new().with_ice_servers(self.ice.clone()).build())
            .with_media_engine(media)
            .with_interceptor_registry(registry)
            .with_handler(Arc::new(Events { hub: self.clone(), id, peer: peer.clone() }))
            .with_udp_addrs(vec!["0.0.0.0:0".to_string()])
            .with_data_channel_send_buffer_limit(SEND_BUFFER)
            .build()
            .await
            .map_err(|e| e.to_string())?;
        let pc: Arc<dyn PeerConnection> = Arc::new(pc);

        let mut tracks = Vec::new();
        for slot in 0..crate::video::MAX_STREAMS {
            let ssrc: u32 = {
                let mut b = [0u8; 4];
                getrandom::fill(&mut b).map_err(|e| e.to_string())?;
                u32::from_le_bytes(b)
            };
            // the stream id tells the viewer which slot a track is ("w0", "w1", …)
            let track = Arc::new(
                TrackLocalStaticSample::new(
                    Instant::now(),
                    MediaStreamTrack::new(
                        format!("w{slot}"),
                        format!("w{slot}"),
                        format!("w{slot}"),
                        RtpCodecKind::Video,
                        vec![RTCRtpEncodingParameters {
                            rtp_coding_parameters: RTCRtpCodingParameters { ssrc: Some(ssrc), ..Default::default() },
                            codec: h264(),
                            ..Default::default()
                        }],
                    ),
                )
                .map_err(|e| e.to_string())?,
            );
            let sender = pc.add_track(track.clone() as Arc<dyn TrackLocal>).await.map_err(|e| e.to_string())?;
            tracks.push(OutTrack { track, sender, ssrc, payload_type: None });
        }
        let dc = pc
            .create_data_channel("pv", Some(RTCDataChannelInit { ordered: true, ..Default::default() }))
            .await
            .map_err(|e| e.to_string())?;
        let files = pc
            .create_data_channel("pvfile", Some(RTCDataChannelInit { ordered: true, ..Default::default() }))
            .await
            .map_err(|e| e.to_string())?;

        self.viewers.lock().unwrap().insert(
            id,
            Viewer {
                peer: peer.clone(),
                name: name.clone(),
                color: color.clone(),
                voice: false,
                pc: pc.clone(),
                dc: Some(dc.clone()),
                previews: HashSet::new(),
                tracks,
                pending: vec![],
                answered: false,
            },
        );
        tauri::async_runtime::spawn(self.clone().channel(id, dc));
        tauri::async_runtime::spawn(self.clone().files(id, files));

        let offer = pc.create_offer(None).await.map_err(|e| e.to_string())?;
        pc.set_local_description(offer).await.map_err(|e| e.to_string())?;
        // the offer goes out right away, candidates follow as they are found (trickle ICE)
        let local = pc.local_description().await.ok_or("no local description")?;
        crate::log("p2p: offer sent");
        self.signaling.send(&json!({
            "type": "offer", "from": "host", "to": peer, "sdp": local, "ice": self.ice_json,
            "id": id, "name": name, "color": color,
        }));
        Ok(())
    }

    async fn connected(&self, id: u32) {
        let senders: Vec<_> = self.viewers.lock().unwrap().get(&id).map(|v| v.tracks.iter().map(|t| t.sender.clone()).collect()).unwrap_or_default();
        for (slot, sender) in senders.into_iter().enumerate() {
            if let Ok(params) = sender.get_parameters().await {
                let pt = params.rtp_parameters.codecs.first().map(|c| c.payload_type);
                if let Some(t) = self.viewers.lock().unwrap().get_mut(&id).and_then(|v| v.tracks.get_mut(slot)) {
                    t.payload_type = pt;
                }
            }
        }
        self.shared.request_key();
    }

    pub async fn remove(&self, id: u32) {
        let Some(viewer) = self.viewers.lock().unwrap().remove(&id) else { return };
        let _ = self.ctrl.send(Cmd::Input(json!({ "t": "left", "id": id })));
        self.broadcast(&json!({ "t": "left", "id": id }), None).await;
        session::route_local(&self.app, &self.shared, &self.ctrl, &json!({ "t": "left", "id": id }));
        self.announce_peers().await;
        let _ = viewer.pc.close().await;
        if self.viewers.lock().unwrap().is_empty() {
            session::remote_viewers_gone(&self.app, &self.shared);
        }
    }

    // ------------------------------------------------------------------ data channel

    async fn channel(self: Arc<Self>, id: u32, dc: Arc<dyn DataChannel>) {
        while let Some(event) = dc.poll().await {
            match event {
                DataChannelEvent::OnOpen => {
                    let (name, color) = match self.viewers.lock().unwrap().get(&id) {
                        Some(v) => (v.name.clone(), v.color.clone()),
                        None => break,
                    };
                    let _ = dc.send_text(&json!({ "t": "welcome", "id": id, "name": name, "color": color, "ice": self.ice_json }).to_string()).await;
                    let _ = dc.send_text(&self.shared.state().to_string()).await;
                    self.announce_peers().await;
                    self.announce_clip().await;
                    self.shared.request_key();
                }
                DataChannelEvent::OnMessage(msg) => {
                    if msg.data.len() <= 64 * 1024 {
                        if let Ok(v) = serde_json::from_slice::<Value>(&msg.data) {
                            self.from_viewer(id, v).await;
                        }
                    }
                }
                DataChannelEvent::OnClose => {
                    self.remove(id).await;
                    break;
                }
                _ => {}
            }
        }
    }

    /// Routing of a viewer's message – what a relay server used to do.
    async fn from_viewer(&self, id: u32, mut v: Value) {
        v["from"] = json!(id);
        let mode = self.shared.mode();
        match v["t"].as_str().unwrap_or("") {
            "voice" => {
                if let Some(viewer) = self.viewers.lock().unwrap().get_mut(&id) {
                    viewer.voice = v["on"] == true;
                }
                self.announce_peers().await;
            }
            "rtc" => {
                let to = v["to"].as_u64().unwrap_or(u64::MAX);
                if to == 0 {
                    let _ = self.app.emit_to("main", "rtc", &v);
                } else {
                    self.send_to(to as u32, &v).await;
                }
            }
            "keyframe" => self.shared.request_key(),
            // remote access: start one of the room's applications (or the desktop)
            "launch" if mode == Mode::Control && self.shared.remote.is_some() => {
                let (app, item, shared) = (self.app.clone(), v["app"].as_str().unwrap_or("").to_string(), self.shared.clone());
                std::thread::spawn(move || {
                    if let Err(e) = session::launch(&app, &item) {
                        crate::log(&format!("launch: {e}"));
                        shared.send(json!({ "t": "launch-error", "to": id, "app": item, "error": e }));
                    }
                });
            }
            // "Resize/Anordnen erlauben": the viewer activated / moved a window in their window manager
            "activate" | "arrange" if mode == Mode::Control && crate::settings::allow_resize() => {
                let (app, slot, kind) = (self.app.clone(), v["w"].as_u64().unwrap_or(0) as u8, v["t"].as_str().unwrap_or("").to_string());
                let (x, y, w, h) = (v["x"].as_f64(), v["y"].as_f64(), v["hw"].as_f64(), v["hh"].as_f64());
                let shared = self.shared.clone();
                std::thread::spawn(move || {
                    if !crate::guard::accessibility() {
                        shared.send(json!({ "t": "blocked", "to": id, "why": "permission" }));
                        shared.need_permission();
                        return;
                    }
                    let result = if kind == "activate" { session::activate_window(&app, slot) } else { session::place_window(&app, slot, x, y, w, h) };
                    if let Err(e) = result {
                        crate::log(&format!("{kind}: {e}"));
                    }
                });
            }
            // … and resized it
            "resize" if mode == Mode::Control && crate::settings::allow_resize() => {
                let (app, slot) = (self.app.clone(), v["w"].as_u64().unwrap_or(0) as u8);
                let (pw, ph) = (v["pw"].as_u64().unwrap_or(0) as u32, v["ph"].as_u64().unwrap_or(0) as u32);
                std::thread::spawn(move || {
                    if let Err(e) = session::resize_window(&app, slot, pw, ph) {
                        crate::log(&format!("resize: {e}"));
                    }
                });
            }
            // how much room the viewer has for a window (device pixels) – for "best size"
            "viewport" => {
                let (w, h) = (v["w"].as_u64().unwrap_or(0).min(16384) as u32, v["h"].as_u64().unwrap_or(0).min(16384) as u32);
                if w >= 200 && h >= 150 {
                    self.shared.viewports.lock().unwrap().insert(id, (w, h));
                }
            }
            "clip-del" => {
                if self.shared.clip.remove(v["id"].as_str().unwrap_or(""), id) {
                    self.shared.clip.changed.notify_one();
                }
            }
            // remote copy & paste go to the controller like keystrokes
            "copy" | "paste" if mode == Mode::Control => {
                session::route_local(&self.app, &self.shared, &self.ctrl, &v);
            }
            // microphone level of a voice participant, for the speaking indicator at their cursor
            "level" => {
                v["v"] = json!(v["v"].as_f64().unwrap_or(0.0).clamp(0.0, 1.0));
                self.broadcast(&v, Some(id)).await;
                session::route_local(&self.app, &self.shared, &self.ctrl, &v);
            }
            "ptr" | "draw" | "ping" | "clear" | "hide" if mode != Mode::View => {
                self.broadcast(&v, Some(id)).await;
                session::route_local(&self.app, &self.shared, &self.ctrl, &v);
            }
            "mouse" | "wheel" | "key" | "text" if mode == Mode::Control => {
                session::route_local(&self.app, &self.shared, &self.ctrl, &v);
            }
            _ => {}
        }
    }

    /// Voice chat messages of the presenter's toolbar.
    pub async fn from_host(&self, mut v: Value) {
        v["from"] = json!(0);
        match v["t"].as_str() {
            Some("voice") => {
                self.host.lock().unwrap().2 = v["on"] == true;
                self.announce_peers().await;
            }
            Some("rtc") => {
                if let Some(to) = v["to"].as_u64() {
                    self.send_to(to as u32, &v).await;
                }
            }
            Some("level") => self.broadcast(&v, None).await,
            _ => {}
        }
    }

    async fn send_to(&self, id: u32, v: &Value) {
        let dc = self.viewers.lock().unwrap().get(&id).and_then(|v| v.dc.clone());
        if let Some(dc) = dc {
            let _ = dc.send_text(&v.to_string()).await;
        }
    }

    async fn broadcast(&self, v: &Value, except: Option<u32>) {
        let text = v.to_string();
        let dcs: Vec<_> = self.viewers.lock().unwrap().iter().filter(|(id, _)| Some(**id) != except).filter_map(|(_, v)| v.dc.clone()).collect();
        for dc in dcs {
            let _ = dc.try_send_text(&text).await;
        }
    }

    async fn announce_peers(&self) {
        let list = {
            let (name, color, voice) = self.host.lock().unwrap().clone();
            let mut list = vec![json!({ "id": 0, "name": name, "color": color, "host": true, "voice": voice })];
            let viewers = self.viewers.lock().unwrap();
            let mut ids: Vec<_> = viewers.keys().copied().collect();
            ids.sort_unstable();
            for id in ids {
                let v = &viewers[&id];
                list.push(json!({ "id": id, "name": v.name, "color": v.color, "voice": v.voice }));
            }
            list
        };
        let msg = json!({ "t": "peers", "list": list });
        self.broadcast(&msg, None).await;
        session::route_local(&self.app, &self.shared, &self.ctrl, &msg);
    }

    // ------------------------------------------------------------------ admission

    /// Open join requests: [{peer, name, color}].
    pub fn requests(&self) -> Vec<Value> {
        self.admission.lock().unwrap().requests()
    }

    pub fn has_request(&self, peer: &str) -> bool {
        self.admission.lock().unwrap().has_request(peer)
    }

    /// The presenter lets a viewer in (or turns them away); `None` = everybody waiting.
    pub async fn admit(self: Arc<Self>, peer: Option<String>, allow: bool) {
        let chosen = self.admission.lock().unwrap().decide(peer.as_deref(), allow);
        session::announce_requests(&self.app);
        for (p, hello) in chosen {
            if allow {
                if let Err(e) = self.clone().invite(p, &hello).await {
                    crate::log(&format!("p2p: invite failed: {e}"));
                }
            } else {
                self.signaling.send(&json!({ "type": "denied", "from": "host", "to": p }));
            }
        }
        self.remember_admitted();
    }

    /// Admitted viewers get back in by themselves after a restart of the app.
    fn remember_admitted(&self) {
        let list = self.admission.lock().unwrap().admitted();
        crate::resume::update(&self.app, "admitted", json!(list));
    }

    pub fn viewer_count(&self) -> usize {
        self.viewers.lock().unwrap().len()
    }

    // ------------------------------------------------------------------ shared clipboard

    async fn clip_changes(self: Arc<Self>) {
        while !self.shared.stop.load(Ordering::Relaxed) {
            self.shared.clip.changed.notified().await;
            self.announce_clip().await;
        }
    }

    /// Item list to everybody: viewers get it without previews, which follow once per item
    /// (data channel messages stay small); the presenter's windows get everything.
    pub async fn announce_clip(&self) {
        let items = self.shared.clip.list();
        let _ = self.app.emit("clip", &items);
        let bare: Vec<Value> = items
            .iter()
            .map(|m| {
                let mut v = json!(m);
                v.as_object_mut().map(|o| o.remove("preview"));
                v
            })
            .collect();
        let text = json!({ "t": "clip", "items": bare }).to_string();
        let targets: Vec<(Arc<dyn DataChannel>, Vec<String>)> = {
            let mut viewers = self.viewers.lock().unwrap();
            viewers
                .values_mut()
                .filter_map(|v| {
                    let dc = v.dc.clone()?;
                    let mut missing = Vec::new();
                    for m in items.iter().filter(|m| m.preview.is_some()) {
                        if v.previews.insert(m.id.clone()) {
                            missing.push(json!({ "t": "clip-preview", "id": m.id, "preview": m.preview }).to_string());
                        }
                    }
                    Some((dc, missing))
                })
                .collect()
        };
        for (dc, previews) in targets {
            let _ = dc.send_text(&text).await;
            for p in previews {
                let _ = dc.send_text(&p).await;
            }
        }
    }

    async fn clip_progress(&self, id: &str, received: u64) {
        let msg = json!({ "t": "clip-progress", "id": id, "received": received });
        let _ = self.app.emit("clip-progress", &msg);
        self.broadcast(&msg, None).await;
    }

    /// The viewer's file channel: uploads arrive as `{t:'put', …}` followed by binary chunks;
    /// `{t:'get', id, req}` asks for an item, served in order by [`serve`](Self::serve).
    async fn files(self: Arc<Self>, id: u32, dc: Arc<dyn DataChannel>) {
        let (get_tx, get_rx) = mpsc::unbounded_channel::<Value>();
        tauri::async_runtime::spawn(self.clone().serve(dc.clone(), get_rx));
        // current upload: item id, hidden (a transfer for remote paste)
        let mut upload: Option<(String, bool)> = None;
        let mut last_progress = Instant::now();
        let reply = |v: Value| {
            let dc = dc.clone();
            async move {
                let _ = dc.send_text(&v.to_string()).await;
            }
        };
        while let Some(event) = dc.poll().await {
            match event {
                DataChannelEvent::OnMessage(msg) if msg.is_string => {
                    let Ok(v) = serde_json::from_slice::<Value>(&msg.data) else { continue };
                    match v["t"].as_str() {
                        Some("put") => {
                            if let Some((old, _)) = upload.take() {
                                self.shared.clip.abort(&old);
                            }
                            let started = Meta::from_json(&v, id).and_then(|m| {
                                let (item, hidden, empty) = (m.id.clone(), m.hidden, m.size == 0);
                                self.shared.clip.begin(m).map(|_| (item, hidden, empty))
                            });
                            match started {
                                Ok((item, hidden, true)) => {
                                    reply(json!({ "t": "stored", "id": item })).await;
                                    if !hidden {
                                        self.shared.clip.changed.notify_one();
                                    }
                                }
                                Ok((item, hidden, false)) => {
                                    if !hidden {
                                        self.shared.clip.changed.notify_one();
                                    }
                                    upload = Some((item, hidden));
                                }
                                Err(e) => reply(json!({ "t": "error", "id": v["id"], "error": e })).await,
                            }
                        }
                        Some("get") => {
                            let _ = get_tx.send(v);
                        }
                        _ => {}
                    }
                }
                DataChannelEvent::OnMessage(msg) => {
                    let Some((item, hidden)) = upload.clone() else { continue };
                    match self.shared.clip.append(&item, &msg.data) {
                        Ok((_, true)) => {
                            upload = None;
                            reply(json!({ "t": "stored", "id": item })).await;
                            if !hidden {
                                self.shared.clip.changed.notify_one();
                            }
                        }
                        Ok((received, false)) => {
                            if !hidden && last_progress.elapsed() >= Duration::from_millis(250) {
                                last_progress = Instant::now();
                                self.clip_progress(&item, received).await;
                            }
                        }
                        Err(e) => {
                            self.shared.clip.abort(&item);
                            upload = None;
                            reply(json!({ "t": "error", "id": item, "error": e })).await;
                            self.shared.clip.changed.notify_one();
                        }
                    }
                }
                DataChannelEvent::OnClose => {
                    if let Some((item, _)) = upload.take() {
                        self.shared.clip.abort(&item);
                        self.shared.clip.changed.notify_one();
                    }
                    break;
                }
                _ => {}
            }
        }
    }

    /// Streams requested items to a viewer: `{t:'data', id, req, size}`, chunks, `{t:'end'}`.
    async fn serve(self: Arc<Self>, dc: Arc<dyn DataChannel>, mut requests: mpsc::UnboundedReceiver<Value>) {
        while let Some(v) = requests.recv().await {
            let (item, req) = (v["id"].as_str().unwrap_or("").to_string(), v["req"].clone());
            let Some((meta, path)) = self.shared.clip.get(&item) else {
                let _ = dc.send_text(&json!({ "t": "error", "id": item, "req": req, "error": "nicht mehr vorhanden" }).to_string()).await;
                continue;
            };
            let Ok(mut file) = std::fs::File::open(&path) else { continue };
            if dc.send_text(&json!({ "t": "data", "id": item, "req": req, "size": meta.size }).to_string()).await.is_err() {
                return;
            }
            let mut buf = vec![0u8; CHUNK];
            loop {
                let n = match file.read(&mut buf) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => n,
                };
                // waits while the channel's buffer is full
                if dc.send(BytesMut::from(&buf[..n])).await.is_err() {
                    return;
                }
            }
            let _ = dc.send_text(&json!({ "t": "end", "id": item, "req": req }).to_string()).await;
        }
    }

    // ------------------------------------------------------------------ outgoing

    /// Presenter messages (state, own pointer) – for everybody, or for one viewer with `"to"`.
    async fn outgoing(self: Arc<Self>, mut out: mpsc::UnboundedReceiver<String>) {
        while let Some(text) = out.recv().await {
            // not for viewers: the presenter is asked for a missing permission (at most once a minute)
            if text.contains("\"need-permission\"") {
                let mut last = self.asked_permission.lock().unwrap();
                if last.is_none_or(|t| t.elapsed() > Duration::from_secs(60)) {
                    *last = Some(Instant::now());
                    crate::permissions::request(&self.app, "accessibility");
                }
                continue;
            }
            let to = text.contains("\"to\"").then(|| serde_json::from_str::<Value>(&text).ok()?["to"].as_u64()).flatten();
            let dcs: Vec<_> = self.viewers.lock().unwrap().iter().filter(|(id, _)| to.is_none_or(|to| u64::from(**id) == to)).filter_map(|(_, v)| v.dc.clone()).collect();
            for dc in dcs {
                let _ = dc.try_send_text(&text).await;
            }
        }
    }

    /// Encoded frames ([2, key, w, h] + Annex B) to every connected viewer's track.
    async fn video(self: Arc<Self>, mut frames: mpsc::Receiver<Vec<u8>>) {
        let mut last = vec![Instant::now(); crate::video::MAX_STREAMS];
        while let Some(packet) = frames.recv().await {
            if packet.len() < 8 || packet[0] != 3 {
                continue;
            }
            let slot = packet[1] as usize;
            let duration = last[slot.min(last.len() - 1)].elapsed().min(Duration::from_millis(200));
            if let Some(l) = last.get_mut(slot) {
                *l = Instant::now();
            }
            let data = Bytes::copy_from_slice(&packet[7..]);
            let targets: Vec<_> = self
                .viewers
                .lock()
                .unwrap()
                .values()
                .filter_map(|v| v.tracks.get(slot).and_then(|t| t.payload_type.map(|pt| (t.track.clone(), t.ssrc, pt))))
                .collect();
            for (track, ssrc, pt) in targets {
                let sample = Sample { data: data.clone(), duration, ..Sample::new(Instant::now()) };
                let _ = track.sample_writer(ssrc, pt).write_sample(&sample).await;
            }
        }
    }
}
