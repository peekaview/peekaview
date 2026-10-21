//! Portable fallback: xcap capture + openh264 software encoder.
//! A shared window is captured on its own (PrintWindow on Windows), never a screen region.

use std::{
    sync::{atomic::Ordering, Arc},
    thread,
    time::{Duration, Instant},
};

use openh264::{
    encoder::{BitRate, Encoder, EncoderConfig, FrameRate, RateControlMode, UsageType},
    formats::{RgbaSliceU8, YUVBuffer},
    OpenH264API,
};
use tokio::sync::mpsc;
use xcap::image::RgbaImage;

use super::{output_size, packet, Source, KEY_GAP};
use super::StreamCtl;
use crate::guard::Rect;

const SOFT_FPS: u32 = 15;

pub struct Video {
    stop: Arc<std::sync::atomic::AtomicBool>,
}

impl Video {
    pub fn start(source: Source, _rect: Rect, shared: Arc<StreamCtl>, frames: mpsc::Sender<Vec<u8>>) -> Result<Self, String> {
        let stop = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let flag = stop.clone();
        thread::spawn(move || run(source, shared, flag, frames));
        Ok(Video { stop })
    }

    pub fn update(&mut self, _rect: Rect) {}

    pub fn tick(&mut self) {}
}

impl Drop for Video {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
    }
}

fn run(source: Source, shared: Arc<StreamCtl>, stop: Arc<std::sync::atomic::AtomicBool>, frames: mpsc::Sender<Vec<u8>>) {
    let interval = Duration::from_millis(1000 / SOFT_FPS as u64);
    let mut encoder: Option<(Encoder, usize, usize)> = None;
    let mut last_key = Instant::now() - KEY_GAP;
    let mut last: Option<Vec<u8>> = None;

    while !stop.load(Ordering::Relaxed) {
        let started = Instant::now();
        let image = shared.visible.load(Ordering::Relaxed).then(|| match &source {
            Source::Screen(m) => m.capture_image(),
            Source::Window(w) => w.capture_image(),
        });
        if let Some(Ok(image)) = image {
            let (w, h, px) = scale(image);
            let mut key = false;
            if encoder.as_ref().is_none_or(|(_, ew, eh)| (*ew, *eh) != (w, h)) {
                let bitrate = ((w * h) as f64 * SOFT_FPS as f64 * 0.08).clamp(1e6, 8e6) as u32;
                let config = EncoderConfig::new()
                    .usage_type(UsageType::ScreenContentRealTime)
                    .rate_control_mode(RateControlMode::Bitrate)
                    .bitrate(BitRate::from_bps(bitrate))
                    .max_frame_rate(FrameRate::from_hz(SOFT_FPS as f32));
                encoder = Encoder::with_api_config(OpenH264API::from_source(), config).ok().map(|e| (e, w, h));
                key = true;
                last = None;
            }
            let Some((enc, _, _)) = encoder.as_mut() else { break };
            if last_key.elapsed() >= KEY_GAP && shared.need_key.swap(false, Ordering::Relaxed) {
                enc.force_intra_frame();
                key = true;
            }
            // unchanged picture: skip, unless a keyframe is needed
            if key || last.as_deref() != Some(&px[..]) {
                let yuv = YUVBuffer::from_rgb_source(RgbaSliceU8::new(&px, (w, h)));
                if let Ok(bits) = enc.encode(&yuv) {
                    let data = bits.to_vec();
                    if !data.is_empty() {
                        if key {
                            last_key = Instant::now();
                        }
                        if frames.blocking_send(packet(shared.slot, &data, key, w, h)).is_err() {
                            return;
                        }
                    }
                }
                last = Some(px);
            }
        }
        thread::sleep(interval.saturating_sub(started.elapsed()));
    }
}

/// Box-downsample to fit the output limits and crop to even dimensions.
fn scale(image: RgbaImage) -> (usize, usize, Vec<u8>) {
    let (iw, ih) = (image.width() as usize, image.height() as usize);
    let (tw, _) = output_size(iw as f64, ih as f64);
    let f = (iw as f64 / tw as f64).ceil().max(1.0) as usize;
    let (w, h) = (((iw / f) & !1).max(2), ((ih / f) & !1).max(2));
    let src = image.as_raw();
    let mut px = vec![0u8; w * h * 4];
    let n = (f * f) as u32;
    for y in 0..h {
        for x in 0..w {
            let mut acc = [0u32; 4];
            for dy in 0..f {
                let row = ((y * f + dy) * iw + x * f) * 4;
                for p in src[row..row + f * 4].chunks_exact(4) {
                    for c in 0..4 {
                        acc[c] += p[c] as u32;
                    }
                }
            }
            let o = (y * w + x) * 4;
            for c in 0..4 {
                px[o + c] = (acc[c] / n) as u8;
            }
        }
    }
    (w, h, px)
}
