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
/// A slow network first costs frames per second, down to this many – each frame stays as sharp
/// as at full speed (as VNC does it: fewer pictures, not blurrier ones). Only below it does the
/// picture get less sharp.
const MIN_FPS: f64 = 5.0;
/// After a change the still picture is encoded this many times more: with nothing moving the
/// encoder spends those frames on detail, so text comes out sharp after scrolling.
const REFINE: u8 = 3;

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
use std::time::{Duration, Instant};

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

    /// Gap between two encoded frames the network allows (see [`MIN_FPS`]).
    pub fn frame_interval(&self) -> Duration {
        frame_interval(self.rate.load(Ordering::Relaxed))
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

/// Frame gap for the network's share of the bitrate (per mille): frames per second fall with the
/// bitrate, so the bits per frame stay the same – down to [`MIN_FPS`].
pub fn frame_interval(rate: u32) -> Duration {
    let share = rate.clamp(100, 1000) as f64 / 1000.0;
    let fps = (FPS as f64 * share).clamp(MIN_FPS, FPS as f64);
    Duration::from_secs_f64(1.0 / fps)
}

/// When a pipeline encodes: a change at most once per [`frame_interval`] (one coming sooner is
/// held back and encoded as soon as its time has come), then [`REFINE`] more times the still
/// picture.
#[derive(Default)]
pub struct Pacer {
    last: Option<Instant>,
    pending: bool,
    refine: u8,
}

impl Pacer {
    /// A new picture: encode it now (true) or hold it back for [`Pacer::due`].
    pub fn changed(&mut self, now: Instant, interval: Duration) -> bool {
        self.refine = REFINE;
        if self.last.is_some_and(|t| now.duration_since(t) < interval) {
            self.pending = true;
            return false;
        }
        self.pending = false;
        true
    }

    /// Asked periodically: encode the last picture again now – a change held back, or the still
    /// picture once more to sharpen it.
    pub fn due(&mut self, now: Instant, interval: Duration) -> bool {
        let Some(last) = self.last else { return false };
        if now.duration_since(last) < interval {
            return false;
        }
        if self.pending {
            self.pending = false;
            return true;
        }
        if self.refine > 0 {
            self.refine -= 1;
            return true;
        }
        false
    }

    /// A frame went to the encoder (keyframes and repeats included).
    pub fn encoded(&mut self, now: Instant) {
        self.last = Some(now);
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

/// BGRA (`pitch` bytes per row) → NV12 at size `out`, BT.709 studio range, box-filtered when
/// smaller. The CPU fallback for GPUs whose own conversion gets the colors wrong (Windows).
#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
pub fn bgra_to_nv12(src: &[u8], (iw, ih): (usize, usize), pitch: usize, (ow, oh): (usize, usize), out: &mut Vec<u8>) {
    out.resize(ow * oh * 3 / 2, 0);
    let (luma, chroma) = out.split_at_mut(ow * oh);
    // source pixels [a, b) that make up output pixel i
    let span = |i: usize, n_out: usize, n_in: usize| {
        let a = (i * n_in / n_out).min(n_in - 1);
        (a, ((i + 1) * n_in / n_out).clamp(a + 1, n_in))
    };
    // R, G, B of two output rows: the chroma of a 2×2 block is their average
    let mut rows = vec![[0i32; 3]; ow * 2];
    for y2 in 0..oh / 2 {
        for r in 0..2 {
            let y = y2 * 2 + r;
            let (sy0, sy1) = span(y, oh, ih);
            for x in 0..ow {
                let (sx0, sx1) = span(x, ow, iw);
                let mut acc = [0u32; 3];
                for sy in sy0..sy1 {
                    for p in src[sy * pitch + sx0 * 4..sy * pitch + sx1 * 4].chunks_exact(4) {
                        acc[0] += p[2] as u32;
                        acc[1] += p[1] as u32;
                        acc[2] += p[0] as u32;
                    }
                }
                let n = ((sy1 - sy0) * (sx1 - sx0)) as u32;
                let [red, green, blue] = acc.map(|c| ((c + n / 2) / n) as i32);
                rows[r * ow + x] = [red, green, blue];
                luma[y * ow + x] = (16 + ((47 * red + 157 * green + 16 * blue + 128) >> 8)) as u8;
            }
        }
        for x2 in 0..ow / 2 {
            let [mut red, mut green, mut blue] = [0i32; 3];
            for i in [x2 * 2, x2 * 2 + 1, ow + x2 * 2, ow + x2 * 2 + 1] {
                red += rows[i][0];
                green += rows[i][1];
                blue += rows[i][2];
            }
            // sums of four pixels: /1024 instead of /256
            chroma[y2 * ow + x2 * 2] = (128 + ((-26 * red - 86 * green + 112 * blue + 512) >> 10)).clamp(0, 255) as u8;
            chroma[y2 * ow + x2 * 2 + 1] = (128 + ((112 * red - 102 * green - 10 * blue + 512) >> 10)).clamp(0, 255) as u8;
        }
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

#[cfg(test)]
mod tests {
    use super::{frame_interval, Pacer, FPS, MIN_FPS, REFINE};
    use std::time::{Duration, Instant};

    /// The network's share of the bitrate costs frames first: the bits per frame stay the same
    /// down to MIN_FPS.
    #[test]
    fn slower_network_fewer_frames() {
        let fps = |rate| 1.0 / frame_interval(rate).as_secs_f64();
        assert!((fps(1000) - FPS as f64).abs() < 0.01);
        assert!((fps(500) - FPS as f64 / 2.0).abs() < 0.01);
        assert!((fps(100) - MIN_FPS).abs() < 0.01, "never below MIN_FPS");
        assert!((fps(5000) - FPS as f64).abs() < 0.01, "never above FPS");
    }

    /// A change sooner than the frame gap waits for it, the still picture follows REFINE times,
    /// then nothing until the next change.
    #[test]
    fn pacer_holds_back_and_refines() {
        let gap = Duration::from_millis(100);
        let t0 = Instant::now();
        let at = |ms| t0 + Duration::from_millis(ms);
        let mut p = Pacer::default();
        assert!(!p.due(t0, gap), "nothing encoded yet: nothing to repeat");
        assert!(p.changed(t0, gap));
        p.encoded(t0);
        assert!(!p.changed(at(30), gap), "too soon: held back");
        assert!(!p.due(at(60), gap));
        assert!(p.due(at(100), gap), "the held-back change, as soon as its time has come");
        p.encoded(at(100));
        let mut repeats = 0;
        let mut t = 100;
        for _ in 0..10 {
            t += 100;
            if p.due(at(t), gap) {
                repeats += 1;
                p.encoded(at(t));
            }
        }
        assert_eq!(repeats, REFINE, "the still picture REFINE times, then rest");
        // a new change starts over
        assert!(p.changed(at(t + 100), gap));
    }

    /// White, black, blue, yellow bars (BGRA) come out as BT.709 studio-range YCbCr – also when
    /// halved in size.
    #[test]
    fn bgra_to_nv12_colors() {
        let bars: [[u8; 4]; 4] = [[255, 255, 255, 255], [0, 0, 0, 255], [255, 0, 0, 255], [0, 255, 255, 255]];
        let want = [(235, 128, 128), (16, 128, 128), (32, 240, 118), (219, 16, 138)];
        for scale in [1, 2] {
            let (w, h) = (64 * scale, 8 * scale);
            let pitch = w * 4 + 16; // rows with padding, as a mapped texture has
            let mut src = vec![0u8; pitch * h];
            for y in 0..h {
                for x in 0..w {
                    src[y * pitch + x * 4..y * pitch + x * 4 + 4].copy_from_slice(&bars[x / (16 * scale)]);
                }
            }
            let mut nv12 = Vec::new();
            super::bgra_to_nv12(&src, (w, h), pitch, (64, 8), &mut nv12);
            assert_eq!(nv12.len(), 64 * 8 * 3 / 2);
            for (i, (wy, wcb, wcr)) in want.into_iter().enumerate() {
                let x = i * 16 + 8;
                let got = (nv12[4 * 64 + x], nv12[64 * 8 + 2 * 64 + x], nv12[64 * 8 + 2 * 64 + x + 1]);
                let near = |a: u8, b: i32| (a as i32 - b).abs() <= 1;
                assert!(near(got.0, wy) && near(got.1, wcb) && near(got.2, wcr), "bar {i} at scale {scale}: {got:?}");
            }
        }
    }
}
