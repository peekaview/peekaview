//! ScreenCaptureKit capture feeding the VideoToolbox encoder.
//!
//! A shared window is captured with a single-window filter: other windows, the desktop,
//! notifications etc. are never part of the picture – even when they overlap the window.

use std::{
    ffi::c_void,
    sync::{atomic::Ordering, Arc, Mutex},
    time::{Duration, Instant},
};

use screencapturekit::{cm::SCFrameStatus, prelude::*};
use tokio::sync::mpsc;

use super::{
    output_size, packet,
    vt::{RetainedBuffer, VtEncoder},
    Source, FPS, KEY_GAP,
};
use crate::{guard::Rect, session::Shared};

struct EncState {
    encoder: Option<VtEncoder>,
    /// last captured frame, re-encoded as keyframe when a viewer joins while nothing moves
    last: Option<RetainedBuffer>,
    last_key: Instant,
    last_frame: Instant,
    frames: mpsc::Sender<Vec<u8>>,
    shared: Arc<Shared>,
}

impl EncState {
    fn encode(&mut self, pb: *const c_void, mut key: bool) {
        let (w, h) = unsafe { VtEncoder::buffer_size(pb) };
        if self.encoder.as_ref().is_none_or(|e| (e.width, e.height) != (w, h)) {
            let (frames, shared) = (self.frames.clone(), self.shared.clone());
            let sink = Box::new(move |data: Vec<u8>, key: bool| {
                // network congested: drop, and recover with a fresh keyframe
                if frames.try_send(packet(&data, key, w, h)).is_err() {
                    shared.need_key.store(true, Ordering::Relaxed);
                }
            });
            self.encoder = VtEncoder::new(w, h, FPS, sink);
            key = true;
        }
        let Some(encoder) = self.encoder.as_mut() else { return };
        if self.last_key.elapsed() >= KEY_GAP && self.shared.need_key.swap(false, Ordering::Relaxed) {
            key = true;
        }
        if unsafe { encoder.encode(pb, key) } {
            self.last_key = Instant::now();
        }
        self.last_frame = Instant::now();
    }
}

struct Handler(Arc<Mutex<EncState>>);

impl SCStreamOutputTrait for Handler {
    fn did_output_sample_buffer(&self, sample: CMSampleBuffer, of_type: SCStreamOutputType) {
        // idle frames (nothing changed) carry no image
        if of_type != SCStreamOutputType::Screen || sample.frame_status() != Some(SCFrameStatus::Complete) {
            return;
        }
        let pb = sample.image_buffer_ptr_borrowed() as *const c_void;
        if pb.is_null() {
            return;
        }
        let mut state = self.0.lock().unwrap();
        state.last = Some(unsafe { RetainedBuffer::new(pb) });
        state.encode(pb, false);
    }
}

pub struct Video {
    stream: SCStream,
    state: Arc<Mutex<EncState>>,
    size: (u32, u32),
}

fn scale_at(rect: Rect) -> f64 {
    xcap::Monitor::from_point(rect.x + rect.w / 2, rect.y + rect.h / 2)
        .and_then(|m| m.scale_factor())
        .map(|s| s as f64)
        .unwrap_or(2.0)
}

fn config(size: (u32, u32)) -> Result<SCStreamConfiguration, String> {
    SCStreamConfiguration::new()
        .with_width(size.0)
        .with_height(size.1)
        .with_pixel_format(PixelFormat::YCbCr_420v)
        .with_fps(FPS)
        .with_queue_depth(6)
        .with_shows_cursor(false)
        .with_ignores_shadows_single_window(true)
        .and_then(|c| c.with_includes_child_windows(true))
        .map_err(|e| e.to_string())
}

impl Video {
    pub fn start(source: Source, rect: Rect, shared: Arc<Shared>, frames: mpsc::Sender<Vec<u8>>) -> Result<Self, String> {
        let err = |e: SCError| format!("Bildschirmaufnahme nicht möglich ({e}). Bitte Bildschirmaufnahme in den Systemeinstellungen erlauben.");
        let content = SCShareableContent::get().map_err(err)?;
        let filter = match &source {
            Source::Screen(m) => {
                let id = m.id().map_err(|e| e.to_string())?;
                let display = content.displays().into_iter().find(|d| d.display_id() == id).ok_or("Bildschirm nicht gefunden")?;
                // never show our own windows (controls, overlay)
                let me = std::process::id() as i32;
                let own: Vec<SCWindow> = content
                    .windows()
                    .into_iter()
                    .filter(|w| w.owning_application().is_some_and(|a| a.process_id() == me))
                    .collect();
                SCContentFilter::create()
                    .with_display(&display)
                    .with_excluding_windows(&own.iter().collect::<Vec<_>>())
                    .build()
            }
            Source::Window(w) => {
                let id = w.id().map_err(|e| e.to_string())?;
                let window = content.windows().into_iter().find(|w| w.window_id() == id).ok_or("Fenster nicht gefunden")?;
                SCContentFilter::create().with_window(&window).build()
            }
        }
        .map_err(err)?;

        let scale = scale_at(rect);
        let size = output_size(rect.w as f64 * scale, rect.h as f64 * scale);
        let state = Arc::new(Mutex::new(EncState {
            encoder: None,
            last: None,
            last_key: Instant::now() - KEY_GAP,
            last_frame: Instant::now(),
            frames,
            shared,
        }));
        let mut stream = SCStream::new(&filter, &config(size)?).map_err(err)?;
        stream.add_output_handler(Handler(state.clone()), SCStreamOutputType::Screen).map_err(err)?;
        stream.start_capture().map_err(err)?;
        Ok(Video { stream, state, size })
    }

    /// The shared area moved or was resized.
    pub fn update(&mut self, rect: Rect) {
        if rect.w <= 0 || rect.h <= 0 {
            return;
        }
        let scale = scale_at(rect);
        let size = output_size(rect.w as f64 * scale, rect.h as f64 * scale);
        if size != self.size {
            if let Ok(cfg) = config(size) {
                if self.stream.update_configuration(&cfg).is_ok() {
                    self.size = size;
                }
            }
        }
    }

    /// Called periodically: answers keyframe requests while the picture is static.
    pub fn tick(&mut self) {
        let mut state = self.state.lock().unwrap();
        let shared = state.shared.clone();
        if shared.need_key.load(Ordering::Relaxed)
            && state.last_frame.elapsed() > Duration::from_millis(150)
            && state.last_key.elapsed() >= KEY_GAP
        {
            if let Some(buf) = state.last.take() {
                state.encode(buf.as_ptr(), true);
                state.last = Some(buf);
            }
        }
    }
}

impl Drop for Video {
    fn drop(&mut self) {
        let _ = self.stream.stop_capture();
    }
}
