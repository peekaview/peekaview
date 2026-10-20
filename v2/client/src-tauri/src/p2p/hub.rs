//! The presenter is the hub of a star of peer-to-peer WebRTC connections – one per viewer, each
//! carrying the H.264 video track and a data channel. It takes over what a relay server would
//! do: participant list, colors, routing by mode, and voice-chat signaling between viewers.

use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicU32, Ordering},
        mpsc as std_mpsc, Arc, Mutex,
    },
    time::{Duration, Instant},
};

use bytes::Bytes;
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

use super::signal::Signaling;
use crate::{
    control::Cmd,
    session::{self, Mode, Shared},
};

const COLORS: [&str; 10] = [
    "#ef4444", "#f97316", "#eab308", "#22c55e", "#14b8a6", "#06b6d4", "#3b82f6", "#8b5cf6", "#d946ef", "#ec4899",
];
const H264_FMTP: &str = "level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f";
const MAX_VIEWERS: usize = 12;

fn h264() -> RTCRtpCodec {
    RTCRtpCodec { mime_type: MIME_TYPE_H264.to_owned(), clock_rate: 90000, channels: 0, sdp_fmtp_line: H264_FMTP.to_owned(), rtcp_feedback: vec![] }
}

struct Viewer {
    peer: String,
    name: String,
    color: String,
    voice: bool,
    pc: Arc<dyn PeerConnection>,
    dc: Option<Arc<dyn DataChannel>>,
    track: Arc<TrackLocalStaticSample>,
    sender: Arc<dyn RtpSender>,
    ssrc: u32,
    payload_type: Option<u8>,
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
        });
        tauri::async_runtime::spawn(hub.clone().signals(incoming));
        tauri::async_runtime::spawn(hub.clone().outgoing(out));
        tauri::async_runtime::spawn(hub.clone().video(frames));
        // viewers already waiting answer right away
        hub.signaling.send(&json!({ "type": "host" }));
        let beacon = hub.clone();
        tauri::async_runtime::spawn(async move {
            while !beacon.shared.stop.load(Ordering::Relaxed) {
                tokio::time::sleep(Duration::from_secs(15)).await;
                beacon.signaling.send(&json!({ "type": "host" }));
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
                Some("hello") if !from.is_empty() => {
                    let known = self.viewers.lock().unwrap().values().any(|v| v.peer == from);
                    if !known {
                        if let Err(e) = self.clone().invite(from, &msg).await {
                            crate::log(&format!("p2p: invite failed: {e}"));
                        }
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
            .build()
            .await
            .map_err(|e| e.to_string())?;
        let pc: Arc<dyn PeerConnection> = Arc::new(pc);

        let ssrc: u32 = {
            let mut b = [0u8; 4];
            getrandom::fill(&mut b).map_err(|e| e.to_string())?;
            u32::from_le_bytes(b)
        };
        let track = Arc::new(
            TrackLocalStaticSample::new(
                Instant::now(),
                MediaStreamTrack::new(
                    "peekaview".into(),
                    "screen".into(),
                    "screen".into(),
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
        let dc = pc
            .create_data_channel("pv", Some(RTCDataChannelInit { ordered: true, ..Default::default() }))
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
                track,
                sender,
                ssrc,
                payload_type: None,
                pending: vec![],
                answered: false,
            },
        );
        tauri::async_runtime::spawn(self.clone().channel(id, dc));

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
        let sender = self.viewers.lock().unwrap().get(&id).map(|v| v.sender.clone());
        if let Some(sender) = sender {
            if let Ok(params) = sender.get_parameters().await {
                let pt = params.rtp_parameters.codecs.first().map(|c| c.payload_type);
                if let Some(v) = self.viewers.lock().unwrap().get_mut(&id) {
                    v.payload_type = pt;
                }
            }
        }
        self.shared.need_key.store(true, Ordering::Relaxed);
    }

    pub async fn remove(&self, id: u32) {
        let Some(viewer) = self.viewers.lock().unwrap().remove(&id) else { return };
        let _ = self.ctrl.send(Cmd::Input(json!({ "t": "left", "id": id })));
        self.broadcast(&json!({ "t": "left", "id": id }), None).await;
        session::route_local(&self.app, &self.shared, &self.ctrl, &json!({ "t": "left", "id": id }));
        self.announce_peers().await;
        let _ = viewer.pc.close().await;
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
                    self.shared.need_key.store(true, Ordering::Relaxed);
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
            "keyframe" => self.shared.need_key.store(true, Ordering::Relaxed),
            "ptr" | "draw" | "ping" | "clear" if mode != Mode::View => {
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

    // ------------------------------------------------------------------ outgoing

    /// Presenter messages for everybody (state, own pointer).
    async fn outgoing(self: Arc<Self>, mut out: mpsc::UnboundedReceiver<String>) {
        while let Some(text) = out.recv().await {
            let dcs: Vec<_> = self.viewers.lock().unwrap().values().filter_map(|v| v.dc.clone()).collect();
            for dc in dcs {
                let _ = dc.try_send_text(&text).await;
            }
        }
    }

    /// Encoded frames ([2, key, w, h] + Annex B) to every connected viewer's track.
    async fn video(self: Arc<Self>, mut frames: mpsc::Receiver<Vec<u8>>) {
        let mut last = Instant::now();
        while let Some(packet) = frames.recv().await {
            if packet.len() < 7 || packet[0] != 2 {
                continue;
            }
            let duration = last.elapsed().min(Duration::from_millis(200));
            last = Instant::now();
            let data = Bytes::copy_from_slice(&packet[6..]);
            let targets: Vec<_> = self
                .viewers
                .lock()
                .unwrap()
                .values()
                .filter_map(|v| v.payload_type.map(|pt| (v.track.clone(), v.ssrc, pt)))
                .collect();
            for (track, ssrc, pt) in targets {
                let sample = Sample { data: data.clone(), duration, ..Sample::new(Instant::now()) };
                let _ = track.sample_writer(ssrc, pt).write_sample(&sample).await;
            }
        }
    }
}
