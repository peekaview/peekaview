//! Injects viewer input – only in control mode and only into the shared area.
//!
//! * Coordinates are clamped to the shared rect, so a drag can never leave it.
//! * For a shared window, a click/scroll is only performed if that window is the topmost one at
//!   that point (it may lie in the background, but that spot must not be covered), and keystrokes
//!   only if the shared window has the keyboard focus – which a viewer's click into it gives it.
//! * Dropped input is reported back to the viewer, so they know why nothing happens.
//! * Copy & paste never emulate typing: the viewer's clipboard content is put on the presenter's
//!   clipboard and the platform's own paste shortcut is pressed (⌘V / Ctrl+V); for copy the
//!   platform's copy shortcut is pressed and the result goes back to the viewer's clipboard.
//!   Everybody keeps their own shortcuts – the viewer sends "paste" / "copy", not keys.
//! * Combos that switch apps or open system UI (app switcher, Spotlight, …) are dropped.

use std::{
    sync::{atomic::Ordering, mpsc, Arc},
    thread,
    time::{Duration, Instant},
};

#[cfg(not(target_os = "windows"))]
use enigo::Coordinate;
use enigo::{Axis, Button, Direction, Enigo, Key, Keyboard, Mouse, Settings};
use serde_json::{json, Value};

use crate::{
    clip::os,
    guard,
    session::{Mode, Shared},
};

const MAX_TEXT: usize = 10_000;
/// pasted text (the clipboard takes far more than typing ever could)
const MAX_PASTE: usize = 10 * 1024 * 1024;
/// copied text up to this size goes back inline, larger text as a clipboard transfer
const INLINE_COPY: usize = 48 * 1024;
/// how long an app may take to put the copied content on the clipboard
const COPY_WAIT: Duration = Duration::from_millis(1500);

pub enum Cmd {
    Input(Value),
    /// release a held mouse button (mode change, session end)
    Release,
}

struct Controller {
    shared: Arc<Shared>,
    enigo: Option<Enigo>,
    /// viewer id + button currently held down on their behalf
    pressed: Option<(u64, Button)>,
    /// last "blocked" notice per viewer (at most one every NOTICE_GAP)
    noticed: std::collections::HashMap<u64, Instant>,
}

const NOTICE_GAP: Duration = Duration::from_millis(1500);

pub fn spawn(shared: Arc<Shared>) -> mpsc::Sender<Cmd> {
    let (tx, rx) = mpsc::channel();
    thread::spawn(move || {
        let mut c = Controller { shared, enigo: None, pressed: None, noticed: Default::default() };
        for cmd in rx {
            match cmd {
                Cmd::Release => c.release(),
                Cmd::Input(v) => {
                    if c.shared.mode() != Mode::Control
                        || c.shared.stop.load(Ordering::Relaxed)
                        || !c.shared.visible.load(Ordering::Relaxed)
                    {
                        c.release();
                    } else {
                        c.handle(&v);
                    }
                }
            }
        }
        c.release();
    });
    tx
}

impl Controller {
    fn enigo(&mut self) -> Option<&mut Enigo> {
        if self.enigo.is_none() {
            // a missing accessibility permission is handled by our own helper window
            self.enigo = match Enigo::new(&Settings { open_prompt_to_get_permissions: false, ..Default::default() }) {
                Ok(e) => Some(e),
                Err(e) => {
                    crate::log(&format!("control: cannot simulate input ({e}) – accessibility permission missing?"));
                    None
                }
            };
        }
        self.enigo.as_mut()
    }

    fn release(&mut self) {
        if let Some((_, button)) = self.pressed.take() {
            if let Some(e) = self.enigo() {
                let _ = e.button(button, Direction::Release);
            }
        }
    }

    fn move_to(&mut self, x: i32, y: i32) {
        #[cfg(target_os = "windows")]
        unsafe {
            // physical pixels on every monitor (enigo's absolute move only covers the primary one)
            windows_sys::Win32::UI::WindowsAndMessaging::SetCursorPos(x, y);
        }
        #[cfg(not(target_os = "windows"))]
        if let Some(e) = self.enigo() {
            let _ = e.move_mouse(x, y, Coordinate::Abs);
        }
    }

    fn injected(&self) {
        *self.shared.injected_at.lock().unwrap() = Some(std::time::Instant::now());
    }

    /// Tells viewer `to` why their input was dropped ("covered" | "focus").
    fn notice(&mut self, to: u64, why: &str) {
        let now = Instant::now();
        if self.noticed.get(&to).is_some_and(|t| now.duration_since(*t) < NOTICE_GAP) {
            return;
        }
        self.noticed.insert(to, now);
        self.shared.send(json!({ "t": "blocked", "to": to, "why": why }));
    }

    /// May a click / scroll of viewer `from` land at screen point (x, y)?
    fn point_allowed(&mut self, from: u64, x: i32, y: i32) -> bool {
        let ok = guard::input_allowed(self.shared.window_id(), x, y);
        if !ok {
            crate::log(&format!("control: dropped at {x},{y} – covered or outside the shared window"));
            self.notice(from, "covered");
        }
        ok
    }

    fn keyboard_allowed(&mut self, from: u64) -> bool {
        let ok = self.shared.window_id().is_none_or(guard::focused);
        if !ok {
            crate::log("control: keyboard dropped – shared window has no focus");
            self.notice(from, "focus");
        }
        ok
    }

    fn handle(&mut self, v: &Value) {
        let from = v["from"].as_u64().unwrap_or(0);
        if from == 0 {
            return;
        }
        let rect = *self.shared.rect.lock().unwrap();
        let point = || rect.point(v["x"].as_f64().unwrap_or(f64::NAN), v["y"].as_f64().unwrap_or(f64::NAN));
        let pressed_by_sender = self.pressed.is_some_and(|(id, _)| id == from);

        match v["t"].as_str().unwrap_or("") {
            "ptr" if pressed_by_sender => {
                let (x, y) = point();
                self.move_to(x, y);
            }
            "left" => {
                if self.pressed.is_some_and(|(id, _)| Some(id) == v["id"].as_u64()) {
                    self.release();
                }
            }
            "mouse" => match v["a"].as_str() {
                Some("down") if self.pressed.is_none() => {
                    let (x, y) = point();
                    if !self.point_allowed(from, x, y) {
                        return;
                    }
                    let button = if v["b"].as_u64() == Some(2) { Button::Right } else { Button::Left };
                    self.move_to(x, y);
                    if let Some(e) = self.enigo() {
                        if e.button(button, Direction::Press).is_ok() {
                            self.pressed = Some((from, button));
                        }
                    }
                    if let Some(rec) = self.shared.recorder() {
                        let pos = ((x - rect.x) as f64 / rect.w.max(1) as f64, (y - rect.y) as f64 / rect.h.max(1) as f64);
                        rec.shot(format!("Klick – {}", rec.name(from)), Some(pos));
                    }
                }
                Some("up") if pressed_by_sender => {
                    let (x, y) = point();
                    self.move_to(x, y);
                    self.release();
                }
                _ => {}
            },
            "wheel" if self.pressed.is_none() => {
                let (x, y) = point();
                if !self.point_allowed(from, x, y) {
                    return;
                }
                self.move_to(x, y);
                let dx = v["dx"].as_i64().unwrap_or(0).clamp(-20, 20) as i32;
                let dy = v["dy"].as_i64().unwrap_or(0).clamp(-20, 20) as i32;
                if let Some(e) = self.enigo() {
                    if dy != 0 {
                        let _ = e.scroll(dy, Axis::Vertical);
                    }
                    if dx != 0 {
                        let _ = e.scroll(dx, Axis::Horizontal);
                    }
                }
            }
            "paste" => self.paste(from, v),
            "copy" => self.copy(from, v),
            "text" => {
                let text: String = v["s"].as_str().unwrap_or("").chars().take(MAX_TEXT).collect();
                if !text.is_empty() && self.keyboard_allowed(from) {
                    self.injected();
                    if let Some(e) = self.enigo() {
                        let _ = e.text(&text);
                    }
                    if let Some(rec) = self.shared.recorder() {
                        rec.typed(rec.name(from));
                    }
                }
            }
            "key" => {
                let name = v["key"].as_str().unwrap_or("");
                let (cmd, shift, alt) = (v["cmd"] == true, v["shift"] == true, v["alt"] == true);
                // app switcher, Spotlight / start menu, force quit … would leave the shared window
                if (cmd || alt) && matches!(name, "Tab" | "Escape" | " ") {
                    return;
                }
                let Some(key) = key_of(name) else { return };
                if !self.keyboard_allowed(from) {
                    return;
                }
                let mut mods = Vec::new();
                if cmd {
                    mods.push(if cfg!(target_os = "macos") { Key::Meta } else { Key::Control });
                }
                if shift {
                    mods.push(Key::Shift);
                }
                if alt {
                    mods.push(Key::Alt);
                }
                self.injected();
                if let Some(rec) = self.shared.recorder() {
                    if name == "Enter" {
                        rec.enter(rec.name(from));
                    } else {
                        rec.typed(rec.name(from));
                    }
                }
                if let Some(e) = self.enigo() {
                    for m in &mods {
                        let _ = e.key(*m, Direction::Press);
                    }
                    let _ = e.key(key, Direction::Click);
                    for m in mods.iter().rev() {
                        let _ = e.key(*m, Direction::Release);
                    }
                }
            }
            _ => {}
        }
    }
}

impl Controller {
    /// The platform's own shortcut with the primary modifier (⌘ on macOS, Ctrl elsewhere).
    fn shortcut(&mut self, key: char) {
        let modifier = if cfg!(target_os = "macos") { Key::Meta } else { Key::Control };
        self.injected();
        if let Some(e) = self.enigo() {
            let _ = e.key(modifier, Direction::Press);
            let _ = e.key(Key::Unicode(key), Direction::Click);
            let _ = e.key(modifier, Direction::Release);
        }
    }

    /// `{t:'paste', text?, html?, textItem?, items?: [clipboard ids]}`: onto the clipboard, then ⌘V / Ctrl+V.
    fn paste(&mut self, from: u64, v: &Value) {
        if !self.keyboard_allowed(from) {
            return;
        }
        let ids: Vec<&str> = v["items"].as_array().into_iter().flatten().filter_map(|i| i.as_str()).collect();
        let items: Vec<_> = ids.iter().filter_map(|id| self.shared.clip.get(id)).collect();
        // long text comes as a clipboard transfer
        let text_item = v["textItem"].as_str().and_then(|id| self.shared.clip.get(id)).and_then(|(_, p)| std::fs::read_to_string(p).ok());
        let text: Option<String> = v["text"].as_str().map(str::to_string).or(text_item).map(|t| t.chars().take(MAX_PASTE).collect());
        let html = v["html"].as_str().filter(|h| h.len() <= MAX_PASTE).map(str::to_string);
        // a single image is pasted as an image (documents, chats), anything else as files
        let single_image = match items.as_slice() {
            [(meta, path)] if meta.mime.starts_with("image/") && meta.mime != "image/svg+xml" => Some(path.clone()),
            _ => None,
        };
        let files: Vec<_> = if single_image.is_some() { vec![] } else { items.iter().map(|(_, p)| p.clone()).collect() };
        let result = if text.is_some() || html.is_some() { os::write(text, html, None, &[]) } else { os::write(None, None, single_image.as_deref(), &files) };
        if let Err(e) = result {
            crate::log(&format!("control: paste failed – {e}"));
            self.notice(from, "paste");
            return;
        }
        self.shortcut('v');
        if let Some(rec) = self.shared.recorder() {
            rec.typed(rec.name(from));
        }
    }

    /// `{t:'copy', req, cut}`: ⌘C / ⌘X (Ctrl elsewhere) in the shared window, then the
    /// clipboard content back to that viewer as `{t:'copied', req, …}`.
    fn copy(&mut self, from: u64, v: &Value) {
        let req = v["req"].clone();
        let reply = |shared: &Shared, body: Value| {
            let mut msg = json!({ "t": "copied", "to": from, "req": req });
            if let (Some(m), Some(b)) = (msg.as_object_mut(), body.as_object()) {
                m.extend(b.clone());
            }
            shared.send(msg);
        };
        if !self.keyboard_allowed(from) {
            return reply(&self.shared, json!({ "empty": true }));
        }
        let before = os::change_count();
        let before_content = if before.is_none() { Some(content_key()) } else { None };
        self.shortcut(if v["cut"] == true { 'x' } else { 'c' });
        let start = Instant::now();
        let changed = loop {
            thread::sleep(Duration::from_millis(30));
            let changed = match before {
                Some(before) => os::change_count() != Some(before),
                None => before_content.as_ref() != Some(&content_key()),
            };
            if changed || start.elapsed() > COPY_WAIT {
                break changed;
            }
        };
        if !changed {
            return reply(&self.shared, json!({ "empty": true }));
        }
        // apps add their formats one after another
        thread::sleep(Duration::from_millis(60));
        let clip = &self.shared.clip;
        let body = match os::read() {
            os::Content::Files(paths) => {
                let files: Vec<Value> = paths
                    .iter()
                    .take(20)
                    .filter_map(|p| clip.add_file(p, 0).map_err(|e| crate::log(&format!("control: copy {p:?} – {e}"))).ok())
                    .map(|m| json!({ "id": m.id, "name": m.name }))
                    .collect();
                clip.changed.notify_one();
                json!({ "files": files })
            }
            os::Content::Png(png) => match clip.add_bytes("Bild.png", "image/png", &png, 0, true) {
                Ok(m) => json!({ "image": m.id }),
                Err(_) => json!({ "empty": true }),
            },
            os::Content::Text { text, html } => {
                if text.len() + html.as_ref().map_or(0, String::len) <= INLINE_COPY {
                    json!({ "text": text, "html": html })
                } else if text.len() <= INLINE_COPY {
                    json!({ "text": text })
                } else {
                    match clip.add_bytes("Text.txt", "text/plain", text.as_bytes(), 0, true) {
                        Ok(m) => json!({ "textItem": m.id }),
                        Err(_) => json!({ "empty": true }),
                    }
                }
            }
            os::Content::Empty => json!({ "empty": true }),
        };
        reply(&self.shared, body);
    }
}

/// Clipboard text where the platform has no change counter.
fn content_key() -> String {
    match os::read() {
        os::Content::Text { text, .. } => text,
        os::Content::Files(f) => format!("{f:?}"),
        os::Content::Png(p) => format!("png:{}", p.len()),
        os::Content::Empty => String::new(),
    }
}

/// Browser `KeyboardEvent.key` -> enigo key
fn key_of(name: &str) -> Option<Key> {
    Some(match name {
        "Enter" => Key::Return,
        "Backspace" => Key::Backspace,
        "Tab" => Key::Tab,
        "Escape" => Key::Escape,
        "Delete" => Key::Delete,
        "ArrowUp" => Key::UpArrow,
        "ArrowDown" => Key::DownArrow,
        "ArrowLeft" => Key::LeftArrow,
        "ArrowRight" => Key::RightArrow,
        "Home" => Key::Home,
        "End" => Key::End,
        "PageUp" => Key::PageUp,
        "PageDown" => Key::PageDown,
        " " => Key::Space,
        "F1" => Key::F1,
        "F2" => Key::F2,
        "F3" => Key::F3,
        "F4" => Key::F4,
        "F5" => Key::F5,
        "F6" => Key::F6,
        "F7" => Key::F7,
        "F8" => Key::F8,
        "F9" => Key::F9,
        "F10" => Key::F10,
        "F11" => Key::F11,
        "F12" => Key::F12,
        _ => {
            let mut chars = name.chars();
            match (chars.next(), chars.next()) {
                (Some(c), None) => Key::Unicode(c),
                _ => return None,
            }
        }
    })
}
