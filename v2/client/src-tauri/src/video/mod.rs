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

/// What a pipeline shares with the rest of the session.
pub struct StreamCtl {
    pub slot: u8,
    /// a viewer needs a keyframe (joined, lost packets)
    pub need_key: std::sync::atomic::AtomicBool,
    /// the window is on screen (not minimized / on another Space)
    pub visible: std::sync::atomic::AtomicBool,
}

impl StreamCtl {
    pub fn new(slot: u8, visible: bool) -> std::sync::Arc<Self> {
        std::sync::Arc::new(StreamCtl {
            slot,
            need_key: std::sync::atomic::AtomicBool::new(true),
            visible: std::sync::atomic::AtomicBool::new(visible),
        })
    }
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
