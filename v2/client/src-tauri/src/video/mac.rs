//! ScreenCaptureKit capture feeding the VideoToolbox encoder.
//!
//! A shared window is captured as its area on the display with only its own app's windows in
//! the filter: its dialogs, sheets and menus are part of the picture, while other apps' windows,
//! the desktop, notifications etc. never are – even when they overlap the window.

use std::{
    ffi::c_void,
    sync::{atomic::Ordering, Arc, Mutex},
    time::{Duration, Instant},
};

use screencapturekit::{
    cm::SCFrameStatus,
    prelude::*,
};
use tokio::sync::mpsc;

use super::{
    output_size, packet,
    vt::{RetainedBuffer, VtEncoder},
    Source, FPS, KEY_GAP,
};
use super::StreamCtl;
use crate::guard::Rect;

struct EncState {
    encoder: Option<VtEncoder>,
    /// last captured frame, re-encoded as keyframe when a viewer joins while nothing moves
    last: Option<RetainedBuffer>,
    last_key: Instant,
    last_frame: Instant,
    frames: mpsc::Sender<Vec<u8>>,
    shared: Arc<StreamCtl>,
    /// submit times of frames in the encoder (it returns them in order) – for the statistics
    submitted: Arc<Mutex<std::collections::VecDeque<Instant>>>,
    /// fingerprint of the last picture
    fingerprint: Option<u64>,
}

impl EncState {
    fn encode(&mut self, pb: *const c_void, mut key: bool) {
        let (w, h) = unsafe { VtEncoder::buffer_size(pb) };
        if self.encoder.as_ref().is_none_or(|e| (e.width, e.height) != (w, h)) {
            let (frames, shared, submitted) = (self.frames.clone(), self.shared.clone(), self.submitted.clone());
            let sink = Box::new(move |data: Vec<u8>, key: bool| {
                if let Some(t) = submitted.lock().unwrap().pop_front() {
                    shared.encode_time(t.elapsed());
                }
                shared.sent(data.len(), w, h);
                // network congested: drop, and recover with a fresh keyframe
                if frames.try_send(packet(shared.slot, &data, key, w, h)).is_err() {
                    shared.need_key.store(true, Ordering::Relaxed);
                }
            });
            self.submitted.lock().unwrap().clear();
            self.encoder = VtEncoder::new(w, h, FPS, self.shared.target_bitrate(w, h), sink);
            key = true;
        }
        let Some(encoder) = self.encoder.as_mut() else { return };
        // nobody watches this window right now (minimized in every viewer)
        if self.shared.idle.load(Ordering::Relaxed) && !self.shared.need_key.load(Ordering::Relaxed) {
            return;
        }
        // what the viewers' network takes
        encoder.set_bitrate(self.shared.target_bitrate(w, h));
        self.shared.bitrate.store(encoder.bitrate, Ordering::Relaxed);
        if self.last_key.elapsed() >= KEY_GAP && self.shared.need_key.swap(false, Ordering::Relaxed) {
            key = true;
        }
        {
            let mut q = self.submitted.lock().unwrap();
            if q.len() > 30 {
                q.clear();
            }
            q.push_back(Instant::now());
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
        // the window overview shows thumbnails in the window's area
        if pb.is_null() || crate::guard::OVERVIEW_ACTIVE.load(Ordering::Relaxed) {
            return;
        }
        // Capturing a window's area delivers every frame as "complete", also when nothing
        // changed: the same picture again (equal fingerprint) is not encoded
        let fingerprint = unsafe { VtEncoder::fingerprint(pb) };
        let mut state = self.0.lock().unwrap();
        let unchanged = fingerprint.is_some() && fingerprint == state.fingerprint && state.last.is_some();
        state.fingerprint = fingerprint;
        state.last = Some(unsafe { RetainedBuffer::new(pb) });
        if !unchanged {
            state.encode(pb, false);
        }
    }
}

/// a static picture is repeated this often
const HEARTBEAT: Duration = Duration::from_secs(1);

pub struct Video {
    stream: SCStream,
    state: Arc<Mutex<EncState>>,
    size: (u32, u32),
    /// a shared window: its app (filter) and the display the area is cut from
    window: Option<WindowArea>,
}

struct WindowArea {
    id: u32,
    display: Rect,
    crop: Rect,
    /// other windows of the app, left out of the picture
    excepted: Vec<u32>,
    checked: Instant,
}

fn display_rect(d: &SCDisplay) -> Rect {
    let f = d.frame();
    Rect { x: f.origin.x as i32, y: f.origin.y as i32, w: f.size.width as i32, h: f.size.height as i32 }
}

/// Filter for a window: the display under its centre, only the window's app on it – without the
/// app's other windows (`guard::foreign_windows_of_app`).
fn window_filter(id: u32, rect: Rect, excepted: &[u32]) -> Result<(SCContentFilter, Rect), String> {
    let content = SCShareableContent::get().map_err(|e| e.to_string())?;
    let all = content.windows();
    let window = all.iter().find(|w| w.window_id() == id).ok_or("Fenster nicht gefunden")?;
    let except: Vec<&SCWindow> = all.iter().filter(|w| excepted.contains(&w.window_id())).collect();
    let app = window.owning_application().ok_or("Anwendung des Fensters nicht gefunden")?;
    let (cx, cy) = (rect.x + rect.w / 2, rect.y + rect.h / 2);
    let displays = content.displays();
    let display = displays
        .iter()
        .find(|d| display_rect(d).contains(cx, cy))
        .or(displays.first())
        .ok_or("Bildschirm nicht gefunden")?;
    let filter = SCContentFilter::create().with_display(display).with_including_applications(&[&app], &except).build().map_err(|e| e.to_string())?;
    Ok((filter, display_rect(display)))
}

/// The window's area relative to its display (points).
fn crop(rect: Rect, display: Rect) -> Rect {
    Rect { x: rect.x - display.x, y: rect.y - display.y, w: rect.w, h: rect.h }
}

fn scale_at(rect: Rect) -> f64 {
    xcap::Monitor::from_point(rect.x + rect.w / 2, rect.y + rect.h / 2)
        .and_then(|m| m.scale_factor())
        .map(|s| s as f64)
        .unwrap_or(2.0)
}

fn config(size: (u32, u32), crop: Option<Rect>) -> Result<SCStreamConfiguration, String> {
    let mut cfg = SCStreamConfiguration::new().with_width(size.0).with_height(size.1);
    if let Some(c) = crop {
        cfg = cfg.with_source_rect(CGRect::new(c.x as f64, c.y as f64, c.w as f64, c.h as f64));
    }
    cfg
        .with_pixel_format(PixelFormat::YCbCr_420v)
        .with_fps(FPS)
        // short queue: frames reach the encoder sooner (latency)
        .with_queue_depth(3)
        .with_shows_cursor(false)
        .with_ignores_shadows_single_window(true)
        .and_then(|c| c.with_includes_child_windows(true))
        .map_err(|e| e.to_string())
}

impl Video {
    pub fn start(source: Source, rect: Rect, shared: Arc<StreamCtl>, frames: mpsc::Sender<Vec<u8>>) -> Result<Self, String> {
        let err = |e: SCError| format!("Bildschirmaufnahme nicht möglich ({e}). Bitte Bildschirmaufnahme in den Systemeinstellungen erlauben.");
        let content = SCShareableContent::get().map_err(err)?;
        let mut area: Option<WindowArea> = None;
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
                let excepted = crate::guard::foreign_windows_of_app(id);
                let (filter, display) = window_filter(id, rect, &excepted)?;
                area = Some(WindowArea { id, display, crop: crop(rect, display), excepted, checked: Instant::now() });
                Ok(filter)
            }
        }
        .map_err(err)?;

        let scale = scale_at(rect);
        let size = super::fit_width(output_size(rect.w as f64 * scale, rect.h as f64 * scale), shared.want_w.load(Ordering::Relaxed));
        let state = Arc::new(Mutex::new(EncState {
            encoder: None,
            last: None,
            last_key: Instant::now() - KEY_GAP,
            last_frame: Instant::now(),
            frames,
            shared: shared.clone(),
            submitted: Arc::default(),
            fingerprint: None,
        }));
        let mut stream = SCStream::new(&filter, &config(size, area.as_ref().map(|a| a.crop))?).map_err(err)?;
        stream.add_output_handler(Handler(state.clone()), SCStreamOutputType::Screen).map_err(err)?;
        stream.start_capture().map_err(err)?;
        Ok(Video { stream, state, size, window: area })
    }

    /// The shared area moved or was resized.
    pub fn update(&mut self, rect: Rect) {
        if rect.w <= 0 || rect.h <= 0 {
            return;
        }
        let scale = scale_at(rect);
        // never more pixels than the viewers display
        let want_w = self.state.lock().unwrap().shared.want_w.load(Ordering::Relaxed);
        let size = super::fit_width(output_size(rect.w as f64 * scale, rect.h as f64 * scale), want_w);
        // a shared window: follow it on its display (and to another display)
        let mut crop_now = None;
        if let Some(area) = self.window.as_mut() {
            if !area.display.contains(rect.x + rect.w / 2, rect.y + rect.h / 2) {
                if let Ok((filter, display)) = window_filter(area.id, rect, &area.excepted) {
                    if self.stream.update_content_filter(&filter).is_ok() {
                        area.display = display;
                    }
                }
            }
            let c = crop(rect, area.display);
            if c != area.crop {
                area.crop = c;
                crop_now = Some(c);
            }
        }
        if size != self.size || crop_now.is_some() {
            if let Ok(cfg) = config(size, self.window.as_ref().map(|a| a.crop)) {
                if self.stream.update_configuration(&cfg).is_ok() {
                    self.size = size;
                }
            }
        }
    }

    /// Called periodically: answers keyframe requests while the picture is static, and keeps
    /// newly opened windows of the app out of the picture.
    pub fn tick(&mut self) {
        if let Some(area) = self.window.as_mut().filter(|a| a.checked.elapsed() > Duration::from_secs(2)) {
            area.checked = Instant::now();
            let excepted = crate::guard::foreign_windows_of_app(area.id);
            if excepted != area.excepted {
                let rect = Rect { x: area.display.x + area.crop.x, y: area.display.y + area.crop.y, w: area.crop.w, h: area.crop.h };
                if let Ok((filter, _)) = window_filter(area.id, rect, &excepted) {
                    if self.stream.update_content_filter(&filter).is_ok() {
                        area.excepted = excepted;
                    }
                }
            }
        }
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
        } else if state.last_frame.elapsed() >= HEARTBEAT && !crate::guard::OVERVIEW_ACTIVE.load(Ordering::Relaxed) {
            // nothing changed for a while: the same picture again (a few bytes) – WebKit shows a
            // video only after more than one frame, and lost packets heal
            if let Some(buf) = state.last.take() {
                state.encode(buf.as_ptr(), false);
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
