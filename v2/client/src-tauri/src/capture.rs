//! Session housekeeping loop: tracks every shared window (position, size, visibility), keeps
//! its red frame on top of it, drives the video pipelines and reports the presenter's own pointer.

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
    session::{self, Shared, Stream},
    video::{Source, Video},
};

const TICK: Duration = Duration::from_millis(33);
const GEOMETRY_EVERY: Duration = Duration::from_millis(150);
const REACHABLE_EVERY: Duration = Duration::from_millis(300);

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

/// Takes over a new set of streams: pipelines of windows that stay keep running, new ones start
/// (each with a keyframe), removed ones stop. On failure nothing changes.
fn switch(app: &AppHandle, shared: &Arc<Shared>, videos: &mut Vec<(u8, Video)>, next: Vec<Stream>, frames: &mpsc::Sender<Vec<u8>>) -> Result<(), String> {
    let mut started = Vec::new();
    for s in next.iter().filter(|s| !videos.iter().any(|(slot, _)| *slot == s.slot)) {
        started.push((s.slot, Video::start(s.source.clone(), s.rect, s.ctl.clone(), frames.clone())?));
    }
    videos.retain(|(slot, _)| next.iter().any(|s| s.slot == *slot));
    videos.extend(started);
    for (slot, _) in videos.iter() {
        if let Some(s) = next.iter().find(|s| s.slot == *slot) {
            session::place_overlay(app, s.slot, s.rect, s.visible());
        }
    }
    let old: Vec<u8> = shared.streams.lock().unwrap().iter().map(|s| s.slot).collect();
    for slot in old.into_iter().filter(|o| !next.iter().any(|s| s.slot == *o)) {
        session::hide_overlay(app, slot);
    }
    *shared.streams.lock().unwrap() = next;
    shared.send_state();
    Ok(())
}

pub fn run(app: AppHandle, shared: Arc<Shared>, mut videos: Vec<(u8, Video)>, frames: mpsc::Sender<Vec<u8>>) {
    let pointer = Enigo::new(&Settings { open_prompt_to_get_permissions: false, ..Default::default() }).ok();
    let mut last_check = Instant::now() - GEOMETRY_EVERY;
    let mut last_reach_check = Instant::now() - REACHABLE_EVERY;
    // presenter's pointer: (slot, x, y)
    let mut last_ptr: Option<(u8, i32, i32)> = None;
    let mut probe = Probe::default();
    let mut last_saved = Instant::now();
    // overlays whose badge currently takes clicks
    let mut clickable: Vec<u8> = Vec::new();
    for s in shared.streams.lock().unwrap().iter() {
        session::place_overlay(&app, s.slot, s.rect, s.visible());
    }

    while !shared.stop.load(Ordering::Relaxed) {
        let started = Instant::now();

        let pending = shared.pending.lock().unwrap().take();
        if let Some((next, reply)) = pending {
            let _ = reply.send(switch(&app, &shared, &mut videos, next, &frames));
            last_ptr = None;
        }

        if last_check.elapsed() >= GEOMETRY_EVERY {
            last_check = Instant::now();
            let streams = shared.streams.lock().unwrap().clone();
            let mut gone = Vec::new();
            let mut changed_visibility = false;
            for s in &streams {
                let Some((rect, visible)) = geometry(&s.source) else {
                    gone.push(s.slot);
                    continue;
                };
                if rect != s.rect || visible != s.visible() {
                    // viewers mirroring the layout follow moves, too
                    changed_visibility = true;
                    s.ctl.visible.store(visible, Ordering::Relaxed);
                    if let Some(stream) = shared.streams.lock().unwrap().iter_mut().find(|x| x.slot == s.slot) {
                        stream.rect = rect;
                    }
                    session::place_overlay(&app, s.slot, rect, visible);
                    if let Some((_, video)) = videos.iter_mut().find(|(slot, _)| *slot == s.slot) {
                        video.update(rect);
                    }
                }
            }
            if !gone.is_empty() {
                // a shared window was closed: the others go on; nothing left ends the share
                if gone.len() == streams.len() {
                    let reason = if streams.len() > 1 { "Die geteilten Fenster wurden geschlossen." } else { "Das geteilte Fenster wurde geschlossen." };
                    session::stop(&app, Some(reason), true);
                    break;
                }
                videos.retain(|(slot, _)| !gone.contains(slot));
                shared.streams.lock().unwrap().retain(|s| !gone.contains(&s.slot));
                for slot in &gone {
                    session::hide_overlay(&app, *slot);
                }
                let ids: Vec<String> = shared.streams.lock().unwrap().iter().map(|s| s.id.clone()).collect();
                crate::resume::update(&app, "sources", json!(ids));
                changed_visibility = true;
            }
            if changed_visibility {
                shared.send_state();
            }
        }

        // viewers are told when remote control of a window is paused because it is covered completely
        if last_reach_check.elapsed() >= REACHABLE_EVERY {
            last_reach_check = Instant::now();
            let streams = shared.streams.lock().unwrap().clone();
            let mut changed = false;
            // the presenter's window stack: which shared window is in front
            if let Some(order) = guard::stack_order() {
                for s in streams.iter() {
                    let z = s.window_id.and_then(|id| order.iter().position(|o| *o == id)).unwrap_or(0) as u32;
                    if z != s.z {
                        changed = true;
                        if let Some(stream) = shared.streams.lock().unwrap().iter_mut().find(|x| x.slot == s.slot) {
                            stream.z = z;
                        }
                    }
                }
            }
            for s in streams.iter().filter(|s| s.window_id.is_some()) {
                let reachable = guard::reachable(s.target(), s.rect);
                if reachable != s.reachable {
                    changed = true;
                    if let Some(stream) = shared.streams.lock().unwrap().iter_mut().find(|x| x.slot == s.slot) {
                        stream.reachable = reachable;
                    }
                }
            }
            if changed {
                shared.send_state();
            }
        }

        for (_, video) in videos.iter_mut() {
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

        // presenter's own mouse pointer, in the shared window it is over
        let location = pointer.as_ref().and_then(|e| e.location().ok());

        // the red frame's badge (top centre) has a button: its overlay takes clicks while the
        // pointer is over it
        let over_badge: Vec<u8> = location
            .map(|(x, y)| {
                shared
                    .streams
                    .lock()
                    .unwrap()
                    .iter()
                    .filter(|s| s.window_id.is_some() && s.visible() && badge_rect(s.rect).contains(x, y))
                    .map(|s| s.slot)
                    .collect()
            })
            .unwrap_or_default();
        for slot in over_badge.iter().filter(|s| !clickable.contains(s)) {
            session::overlay_clickable(&app, *slot, true);
        }
        for slot in clickable.iter().filter(|s| !over_badge.contains(s)) {
            session::overlay_clickable(&app, *slot, false);
        }
        clickable = over_badge;
        let ptr = location.and_then(|(x, y)| under(&shared, x, y).map(|s| (s.slot, x, y)));
        if ptr != last_ptr {
            if let Some((old, ..)) = last_ptr.filter(|(old, ..)| ptr.is_none_or(|(slot, ..)| slot != *old)) {
                shared.send(json!({ "t": "hide", "from": 0, "w": old }));
            }
            if let Some((slot, x, y)) = ptr {
                if let Some(s) = shared.stream(slot) {
                    let (nx, ny) = s.normalize(x, y);
                    shared.send(json!({ "t": "ptr", "from": 0, "w": slot, "x": nx, "y": ny }));
                }
            }
            last_ptr = ptr;
        }

        thread::sleep(TICK.saturating_sub(started.elapsed()));
    }
}

/// Where the overlay's badge sits (overlay.html: top centre, at most 300 × 26).
fn badge_rect(r: Rect) -> Rect {
    let w = 300.min(r.w);
    Rect { x: r.x + (r.w - w) / 2, y: r.y, w, h: 26 }
}

/// The visible shared window at a screen point (the topmost one if they overlap).
fn under(shared: &Shared, x: i32, y: i32) -> Option<Stream> {
    let streams = shared.streams.lock().unwrap();
    let candidates: Vec<&Stream> = streams.iter().filter(|s| s.visible() && s.rect.contains(x, y)).collect();
    match candidates.as_slice() {
        [] => None,
        [one] => Some((*one).clone()),
        many => many.iter().find(|s| guard::input_allowed(s.target(), x, y)).or(many.first()).map(|s| (*s).clone()),
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
    let streams = shared.streams.lock().unwrap().clone();
    let in_front = streams.iter().any(|s| s.target().is_none_or(guard::focused));

    let button = input::left_button();
    if button && !probe.button {
        if let Some((x, y)) = pointer.and_then(|e| e.location().ok()) {
            if let Some(s) = under(shared, x, y).filter(|s| guard::input_allowed(s.target(), x, y)) {
                rec.set_source(s.source.clone());
                rec.shot(format!("Klick – {}", rec.name(0)), Some(s.normalize(x, y)));
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
