//! Session housekeeping loop: tracks the shared area (position, size, visibility), keeps the
//! overlay on top of it, drives the video pipeline and reports the presenter's own pointer.

use std::{
    sync::{atomic::Ordering, Arc},
    thread,
    time::{Duration, Instant},
};

use enigo::{Enigo, Mouse, Settings};
use serde_json::json;
use tauri::AppHandle;
use tokio::sync::mpsc;

use crate::{
    guard::{self, Rect},
    input,
    recording::Recorder,
    session::{self, Shared},
    video::{Source, Video},
};

const TICK: Duration = Duration::from_millis(33);
const GEOMETRY_EVERY: Duration = Duration::from_millis(150);
const FOREGROUND_EVERY: Duration = Duration::from_millis(300);

/// Current geometry of the source: `None` once a shared window is gone.
pub fn geometry(source: &Source) -> Option<(Rect, bool)> {
    match source {
        Source::Screen(m) => Some((
            Rect {
                x: m.x().unwrap_or(0),
                y: m.y().unwrap_or(0),
                w: m.width().unwrap_or(0) as i32,
                h: m.height().unwrap_or(0) as i32,
            },
            true,
        )),
        Source::Window(w) => guard::window_geometry(w),
    }
}

pub fn run(app: AppHandle, shared: Arc<Shared>, mut source: Source, video: Video, frames: mpsc::Sender<Vec<u8>>) {
    let mut video = Some(video);
    let pointer = Enigo::new(&Settings { open_prompt_to_get_permissions: false, ..Default::default() }).ok();
    let mut last_geom: Option<(Rect, bool)> = None;
    let mut last_check = Instant::now() - GEOMETRY_EVERY;
    let mut last_focus_check = Instant::now() - FOREGROUND_EVERY;
    let mut last_ptr: Option<(i32, i32)> = None;
    let mut probe = Probe::default();
    let mut last_saved = Instant::now();

    while !shared.stop.load(Ordering::Relaxed) {
        let started = Instant::now();

        // switch to another source: stop the old pipeline first (its encoder flushes), so
        // viewers never get frames of both; the new one starts with a keyframe
        let pending = shared.pending.lock().unwrap().take();
        if let Some((next, reply)) = pending {
            let result = geometry(&next).ok_or_else(|| "Quelle nicht mehr vorhanden".to_string()).and_then(|(rect, _)| {
                video = None;
                shared.need_key.store(true, Ordering::Relaxed);
                Video::start(next.clone(), rect, shared.clone(), frames.clone())
            });
            match result {
                Ok(v) => {
                    video = Some(v);
                    source = next;
                    last_geom = None;
                    last_check = Instant::now() - GEOMETRY_EVERY;
                    last_ptr = None;
                    let _ = reply.send(Ok(()));
                }
                Err(e) => {
                    // keep sharing the previous source
                    if video.is_none() {
                        if let Some((rect, _)) = geometry(&source) {
                            video = Video::start(source.clone(), rect, shared.clone(), frames.clone()).ok();
                        }
                    }
                    let _ = reply.send(Err(e));
                }
            }
        }

        if last_check.elapsed() >= GEOMETRY_EVERY {
            last_check = Instant::now();
            let Some((rect, visible)) = geometry(&source) else {
                session::stop(&app, Some("Das geteilte Fenster wurde geschlossen."), true);
                break;
            };
            if last_geom != Some((rect, visible)) {
                *shared.rect.lock().unwrap() = rect;
                shared.visible.store(visible, Ordering::Relaxed);
                session::place_overlay(&app, rect, visible);
                if let Some(video) = video.as_mut() {
                    video.update(rect);
                }
                if last_geom.map(|g| g.1) != Some(visible) {
                    shared.send_state();
                }
                last_geom = Some((rect, visible));
            }
        }

        // viewers are told when remote control is paused because the window isn't in front
        if let (Some(id), true) = (shared.window_id(), last_focus_check.elapsed() >= FOREGROUND_EVERY) {
            last_focus_check = Instant::now();
            let focused = guard::focused(id);
            if shared.foreground.swap(focused, Ordering::Relaxed) != focused {
                shared.send_state();
            }
        }

        if let Some(video) = video.as_mut() {
            video.tick();
        }

        if let Some(rec) = shared.recorder() {
            rec.tick();
            record_presenter_input(&shared, &rec, &mut probe, pointer.as_ref());
        }
        if last_saved.elapsed() >= Duration::from_secs(20) {
            last_saved = Instant::now();
            crate::resume::touch(&app);
        }

        // presenter's own mouse pointer, only while it is inside the shared area
        let rect = *shared.rect.lock().unwrap();
        let ptr = pointer
            .as_ref()
            .filter(|_| shared.visible.load(Ordering::Relaxed))
            .and_then(|e| e.location().ok())
            .filter(|&(x, y)| rect.contains(x, y));
        if ptr != last_ptr {
            match ptr {
                Some((x, y)) => shared.send(json!({
                    "t": "ptr", "from": 0,
                    "x": (x - rect.x) as f64 / rect.w as f64,
                    "y": (y - rect.y) as f64 / rect.h as f64,
                })),
                None => shared.send(json!({ "t": "hide", "from": 0 })),
            }
            last_ptr = ptr;
        }

        thread::sleep(TICK.saturating_sub(started.elapsed()));
    }
}

#[derive(Default)]
struct Probe {
    button: bool,
    enter: bool,
}

/// The presenter's own clicks and text entries for the recording (viewer input is recorded where
/// it is injected; screenshots closer than a moment apart are merged).
fn record_presenter_input(shared: &Shared, rec: &Recorder, probe: &mut Probe, pointer: Option<&Enigo>) {
    let rect = *shared.rect.lock().unwrap();
    let in_front = shared.window_id().is_none_or(guard::focused);

    let button = input::left_button();
    if button && !probe.button {
        if let Some((x, y)) = pointer.and_then(|e| e.location().ok()) {
            if rect.contains(x, y) && in_front && guard::input_allowed(shared.window_id(), x, y) {
                let pos = ((x - rect.x) as f64 / rect.w as f64, (y - rect.y) as f64 / rect.h as f64);
                rec.shot(format!("Klick – {}", rec.name(0)), Some(pos));
            }
        }
    }
    probe.button = button;

    let injected_recently = shared.injected_at.lock().unwrap().is_some_and(|t| t.elapsed() < Duration::from_millis(400));
    let enter = input::enter_key();
    if enter && !probe.enter && in_front && !injected_recently {
        rec.enter(rec.name(0));
    }
    probe.enter = enter;

    if input::secs_since_key().is_some_and(|s| s < 0.15) && in_front && !injected_recently {
        rec.typed(rec.name(0));
    }
}
