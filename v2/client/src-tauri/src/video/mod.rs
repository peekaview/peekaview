//! Video pipeline: capture → H.264 → relay. Viewers decode with WebCodecs (hardware).
//!
//! * macOS: ScreenCaptureKit (GPU frames, zero copy) → VideoToolbox hardware encoder
//! * Windows: Windows.Graphics.Capture → D3D11 video processor → Media Foundation (the GPU's
//!   hardware encoder, Windows' software encoder as fallback)
//! * Linux: xcap → openh264 (software)
//!
//! Several windows can be shared at once: each runs its own pipeline in one of [`MAX_STREAMS`]
//! slots, and every viewer connection carries one video track per slot.
//!
//! Packet handed to the P2P hub:
//! [3u8, slot, flags (bit0 = keyframe), width u16 LE, height u16 LE] + Annex B

#[cfg(target_os = "macos")]
mod mac;
#[cfg(target_os = "macos")]
mod vt;
#[cfg(target_os = "macos")]
pub use mac::Video;

#[cfg(target_os = "windows")]
mod win;
#[cfg(target_os = "windows")]
pub use win::Video;

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
mod soft;
#[cfg(not(any(target_os = "macos", target_os = "windows")))]
pub use soft::Video;

pub const FPS: u32 = 30;
/// Windows that can be shared at the same time (= video tracks per viewer connection).
pub const MAX_STREAMS: usize = 6;
const MAX_W: f64 = 2560.0;
const MAX_H: f64 = 1600.0;
/// minimum gap between two requested keyframes
const KEY_GAP: std::time::Duration = std::time::Duration::from_millis(500);

/// What a pipeline shares with the rest of the session: requests from the viewers (keyframe,
/// size they display, bitrate their network takes) and counters for the statistics.
pub struct StreamCtl {
    pub slot: u8,
    /// a viewer needs a keyframe (joined, lost packets)
    pub need_key: AtomicBool,
    /// the window is on screen (not minimized / on another Space)
    pub visible: AtomicBool,
    /// widest picture any viewer displays (pixels); 0 = full size – fewer pixels, less bitrate
    pub want_w: AtomicU32,
    /// `want_w` changed: the capture size should follow
    pub resize: AtomicBool,
    /// nobody watches it (minimized in every viewer): no encoding
    pub idle: AtomicBool,
    /// share of the bitrate for the size the network allows, per mille (congestion control)
    pub rate: AtomicU32,
    // statistics
    pub bytes: AtomicU64,
    pub frames: AtomicU32,
    pub encode_us: AtomicU64,
    pub encoded: AtomicU32,
    /// encoded picture size (w << 16 | h) and bitrate in use
    pub size: AtomicU32,
    pub bitrate: AtomicU32,
}

use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};

impl StreamCtl {
    pub fn new(slot: u8, visible: bool) -> std::sync::Arc<Self> {
        std::sync::Arc::new(StreamCtl {
            slot,
            need_key: AtomicBool::new(true),
            visible: AtomicBool::new(visible),
            want_w: AtomicU32::new(0),
            resize: AtomicBool::new(false),
            idle: AtomicBool::new(false),
            rate: AtomicU32::new(1000),
            bytes: AtomicU64::new(0),
            frames: AtomicU32::new(0),
            encode_us: AtomicU64::new(0),
            encoded: AtomicU32::new(0),
            size: AtomicU32::new(0),
            bitrate: AtomicU32::new(0),
        })
    }

    /// Bitrate for a picture size, scaled to what the network allows.
    pub fn target_bitrate(&self, w: usize, h: usize) -> u32 {
        let rate = self.rate.load(Ordering::Relaxed).clamp(100, 1000) as f64 / 1000.0;
        (base_bitrate(w, h) * rate).max(250_000.0) as u32
    }

    /// The pipeline sent an encoded frame.
    pub fn sent(&self, bytes: usize, w: usize, h: usize) {
        self.bytes.fetch_add(bytes as u64, Ordering::Relaxed);
        self.frames.fetch_add(1, Ordering::Relaxed);
        self.size.store(((w as u32) << 16) | (h as u32 & 0xffff), Ordering::Relaxed);
    }

    pub fn encode_time(&self, d: std::time::Duration) {
        self.encode_us.fetch_add(d.as_micros() as u64, Ordering::Relaxed);
        self.encoded.fetch_add(1, Ordering::Relaxed);
    }
}

/// Screen content: ~0.05 bit per pixel and frame is plenty for sharp text.
pub fn base_bitrate(w: usize, h: usize) -> f64 {
    ((w * h) as f64 * FPS as f64 * 0.05).clamp(1.5e6, 12e6)
}

/// Shrinks a picture size to the width viewers actually display (never enlarges).
pub fn fit_width((w, h): (u32, u32), want_w: u32) -> (u32, u32) {
    if want_w == 0 || want_w >= w {
        return (w, h);
    }
    let s = want_w as f64 / w as f64;
    let even = |v: f64| ((v as u32) & !1).max(2);
    (even(w as f64 * s), even(h as f64 * s))
}

#[derive(Clone)]
pub enum Source {
    Screen(xcap::Monitor),
    Window(xcap::Window),
}

// SAFETY: on Windows xcap keeps a raw HMONITOR / HWND. These are process-wide identifiers that
// may be used from any thread; nothing in them is tied to the thread that created them.
#[cfg(target_os = "windows")]
unsafe impl Send for Source {}

/// Fit a pixel size into MAX_W × MAX_H, keeping the aspect ratio; even sizes for 4:2:0.
pub fn output_size(w: f64, h: f64) -> (u32, u32) {
    let s = (MAX_W / w).min(MAX_H / h).min(1.0);
    let even = |v: f64| (((v * s) as u32) & !1).max(2);
    (even(w), even(h))
}

pub fn packet(slot: u8, annex_b: &[u8], key: bool, w: usize, h: usize) -> Vec<u8> {
    let mut out = Vec::with_capacity(annex_b.len() + 7);
    out.push(3u8);
    out.push(slot);
    out.push(key as u8);
    out.extend_from_slice(&(w as u16).to_le_bytes());
    out.extend_from_slice(&(h as u16).to_le_bytes());
    out.extend_from_slice(annex_b);
    out
}
