//! Injects viewer input – only in control mode and only into the shared windows.
//!
//! * Every message names the shared window it is meant for ("w"); coordinates are relative to
//!   it and clamped to its rect, so a drag can never leave it.
//! * For a shared window, a click/scroll is only performed if that window is the topmost one at
//!   that point (it may lie in the background, but that spot must not be covered), and keystrokes
//!   only if the shared window has the keyboard focus – which a viewer's click into it gives it.
//! * Dropped input is reported back to the viewer, so they know why nothing happens.
//! * Copy & paste never emulate typing: the viewer's clipboard content is put on the presenter's
//!   clipboard and the platform's own paste shortcut is pressed (⌘V / Ctrl+V); for copy the
//!   platform's copy shortcut is pressed and the result goes back to the viewer's clipboard.
//!   Everybody keeps their own shortcuts – the viewer sends "paste" / "copy", not keys.
//! * Combos that switch apps or open system UI (app switcher, Spotlight, …) are dropped while a
//!   window is shared; with a whole screen shared they go through, like the special keys from the
//!   viewer's menu ("special": Strg+Alt+Entf, Windows key, Alt+Tab, lock …).
//! * The SYSTEM helper of the PeekaView service follows the input desktop before every input, so
//!   it reaches the sign-in screen and UAC prompts as well.

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
    guard::{self, Target},
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

/// What simulates input: enigo, or at the Mac's login window `Legacy` (see `unattended::mac::legacy`).
trait Device: Keyboard + Mouse {}
impl<T: Keyboard + Mouse> Device for T {}

struct Controller {
    shared: Arc<Shared>,
    enigo: Option<Box<dyn Device>>,
    /// viewer id + button currently held down on their behalf + the window (slot) it is in
    pressed: Option<(u64, Button, u8)>,
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
                    if c.shared.mode() != Mode::Control || c.shared.stop.load(Ordering::Relaxed) {
                        c.release();
                    } else {
                        // the service's agent on the Mac: enigo looks key codes up in the keyboard
                        // layout (HIToolbox), which the login window allows on the main thread only
                        #[cfg(target_os = "macos")]
                        if crate::unattended::helper() {
                            on_main(|| c.handle(&v));
                            continue;
                        }
                        c.handle(&v);
                    }
                }
            }
        }
        c.release();
    });
    tx
}

/// enigo with a private event source; where macOS refuses that (the service's agent at the login
/// window runs as root without a user session) one that shares the session's keyboard state.
pub(crate) fn new_enigo() -> Result<Enigo, enigo::NewConError> {
    let settings = Settings { open_prompt_to_get_permissions: false, ..Default::default() };
    Enigo::new(&settings).or_else(|e| {
        #[cfg(target_os = "macos")]
        if matches!(e, enigo::NewConError::EstablishCon(_)) {
            return Enigo::new(&Settings { independent_of_keyboard_state: false, ..settings });
        }
        Err(e)
    })
}

/// Types `text`. The service's agent on the Mac presses a key per character (key codes from the
/// keyboard layout): password fields with secure input – the login window, the lock screen – drop
/// the Unicode strings `Enigo::text` sends.
fn type_text(e: &mut dyn Device, text: &str) {
    #[cfg(target_os = "macos")]
    if crate::unattended::helper() {
        for c in text.chars() {
            let result = match c {
                '\n' | '\r' => e.key(Key::Return, Direction::Click),
                '\t' => e.key(Key::Tab, Direction::Click),
                c => e.key(Key::Unicode(c), Direction::Click).or_else(|_| e.text(&c.to_string())),
            };
            if let Err(err) = result {
                crate::log(&format!("control: cannot type ({err})"));
                return;
            }
        }
        return;
    }
    let _ = e.text(text);
}

/// Runs `f` on the main thread and waits for it (libdispatch; never called from the main thread).
#[cfg(target_os = "macos")]
fn on_main<F: FnOnce()>(f: F) {
    use std::ffi::c_void;
    extern "C" {
        static _dispatch_main_q: c_void;
        fn dispatch_sync_f(queue: *const c_void, context: *mut c_void, work: extern "C" fn(*mut c_void));
    }
    extern "C" fn trampoline<F: FnOnce()>(context: *mut c_void) {
        if let Some(f) = unsafe { &mut *(context as *mut Option<F>) }.take() {
            f();
        }
    }
    let mut f = Some(f);
    unsafe { dispatch_sync_f(&raw const _dispatch_main_q, (&mut f as *mut Option<F>).cast(), trampoline::<F>) };
}

impl Controller {
    fn enigo(&mut self) -> Option<&mut (dyn Device + 'static)> {
        if self.enigo.is_none() {
            // the service's agent at the login window (root): macOS ignores CGEventPost there
            #[cfg(target_os = "macos")]
            if crate::unattended::helper() && crate::unattended::mac::console::root() {
                crate::log("control: login window, input through the legacy event functions");
                self.enigo = Some(Box::new(crate::unattended::mac::legacy::Legacy::new()));
                return self.enigo.as_deref_mut();
            }
            // a missing accessibility permission is handled by our own helper window
            self.enigo = match new_enigo() {
                Ok(e) => Some(Box::new(e)),
                Err(e) => {
                    crate::log(&format!("control: cannot simulate input ({e}) – accessibility permission missing?"));
                    None
                }
            };
        }
        self.enigo.as_deref_mut()
    }

    fn release(&mut self) {
        if let Some((_, button, _)) = self.pressed.take() {
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

    /// May a click / scroll of viewer `from` land at screen point (x, y)? With "Resize/Anordnen
    /// erlauben" a covered window is brought to the front first.
    fn point_allowed(&mut self, from: u64, target: Target, x: i32, y: i32) -> bool {
        let mut ok = guard::input_allowed(target, x, y);
        if !ok && crate::settings::allow_resize() {
            if let Some((id, pid)) = target.filter(|_| guard::accessibility()) {
                crate::focus::bring_to_front(pid as u32, id);
                thread::sleep(Duration::from_millis(180));
                ok = guard::input_allowed(target, x, y);
            }
        }
        if !guard::accessibility() {
            crate::log("control: accessibility permission missing");
            self.notice(from, "permission");
            self.shared.need_permission();
            return false;
        }
        if !ok {
            crate::log(&format!("control: dropped at {x},{y} – covered or outside the shared window"));
            self.notice(from, "covered");
        }
        ok
    }

    fn keyboard_allowed(&mut self, from: u64, target: Target) -> bool {
        let ok = target.is_none_or(guard::focused);
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
        // the helper of the service: input goes to the desktop that receives input right now
        #[cfg(target_os = "windows")]
        if crate::unattended::helper() && crate::unattended::desk::win::follow_input_desktop() {
            self.enigo = None;
        }
        // the window the message is about; a drag stays in the window it started in
        let pressed_by_sender = self.pressed.is_some_and(|(id, ..)| id == from);
        let stream = match self.pressed.filter(|_| pressed_by_sender) {
            Some((_, _, slot)) => self.shared.stream(slot),
            None => self.shared.stream_of(v),
        };
        // the service's helper: the first input of each kind goes to the log (input is the part
        // that fails silently without the accessibility permission)
        if crate::unattended::helper() {
            use std::sync::Mutex;
            static SEEN: Mutex<Vec<String>> = Mutex::new(Vec::new());
            let kind = v["t"].as_str().unwrap_or("").to_string();
            let mut seen = SEEN.lock().unwrap();
            if !seen.contains(&kind) && seen.len() < 32 {
                crate::log(&format!("control: first {kind} (stream: {}, accessibility: {})", stream.as_ref().map(|s| s.visible()).unwrap_or(false), guard::accessibility()));
                seen.push(kind);
            }
        }
        let Some(stream) = stream.filter(|s| s.visible()) else {
            self.release();
            return;
        };
        let (rect, target) = (stream.rect, stream.target());
        let point = || rect.point(v["x"].as_f64().unwrap_or(f64::NAN), v["y"].as_f64().unwrap_or(f64::NAN));

        match v["t"].as_str().unwrap_or("") {
            "ptr" if pressed_by_sender => {
                let (x, y) = point();
                self.move_to(x, y);
            }
            "left" => {
                if self.pressed.is_some_and(|(id, ..)| Some(id) == v["id"].as_u64()) {
                    self.release();
                }
            }
            "mouse" => match v["a"].as_str() {
                Some("down") if self.pressed.is_none() => {
                    let (x, y) = point();
                    if !self.point_allowed(from, target, x, y) {
                        return;
                    }
                    let button = if v["b"].as_u64() == Some(2) { Button::Right } else { Button::Left };
                    self.move_to(x, y);
                    if let Some(e) = self.enigo() {
                        if e.button(button, Direction::Press).is_ok() {
                            self.pressed = Some((from, button, stream.slot));
                        }
                    }
                    if let Some(rec) = self.shared.recorder() {
                        rec.set_source(stream.source.clone());
                        rec.shot(format!("Klick – {}", rec.name(from)), Some(stream.normalize(x, y)));
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
                if !self.point_allowed(from, target, x, y) {
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
            "paste" => self.paste(from, target, v),
            "special" => self.special(from, target, v["k"].as_str().unwrap_or("")),
            "copy" => self.copy(from, target, v),
            "text" => {
                let text: String = v["s"].as_str().unwrap_or("").chars().take(MAX_TEXT).collect();
                if !text.is_empty() && self.keyboard_allowed(from, target) {
                    self.injected();
                    if let Some(e) = self.enigo() {
                        type_text(e, &text);
                    }
                    if let Some(rec) = self.shared.recorder() {
                        rec.typed(rec.name(from));
                    }
                }
            }
            "key" => {
                let name = v["key"].as_str().unwrap_or("");
                let (cmd, shift, alt) = (v["cmd"] == true, v["shift"] == true, v["alt"] == true);
                // Windows key held (a viewer on Windows / Linux, with the keyboard lock in fullscreen)
                let win = v["win"] == true;
                // app switcher, Spotlight / start menu, force quit … would leave the shared window
                if app_switch_dropped(target.is_some(), cmd || alt || win, name) {
                    return;
                }
                let Some(key) = key_of(name) else { return };
                if !self.keyboard_allowed(from, target) {
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
                if win {
                    mods.push(Key::Meta);
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

/// A shortcut that would leave a shared *window* (app switcher, start menu / Spotlight, …): dropped
/// for windows, allowed when a whole screen is shared.
fn app_switch_dropped(window: bool, modified: bool, key: &str) -> bool {
    window && modified && matches!(key, "Tab" | "Escape" | " ")
}

/// Ctrl+Cmd+Q did not lock (no keyboard attached, shortcut changed …): login.framework.
fn mac_lock_fallback() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        for _ in 0..6 {
            std::thread::sleep(std::time::Duration::from_millis(250));
            if crate::lock::locked() {
                return Ok(());
            }
        }
        type Lock = unsafe extern "C" fn() -> i32;
        unsafe {
            let lib = libc::dlopen(c"/System/Library/PrivateFrameworks/login.framework/Versions/Current/login".as_ptr(), libc::RTLD_LAZY);
            if !lib.is_null() {
                let f = libc::dlsym(lib, c"SACLockScreenImmediate".as_ptr());
                if !f.is_null() {
                    let lock: Lock = std::mem::transmute(f);
                    lock();
                }
            }
        }
        std::thread::sleep(std::time::Duration::from_millis(500));
        if crate::lock::locked() {
            Ok(())
        } else {
            Err("Der Mac ließ sich nicht sperren.".into())
        }
    }
    #[cfg(not(target_os = "macos"))]
    Err("Sperren geht hier nicht.".into())
}

fn special_key(k: crate::unattended::special::K) -> Key {
    use crate::unattended::special::K;
    match k {
        K::Ctrl => Key::Control,
        K::Alt => Key::Alt,
        K::Shift => Key::Shift,
        K::Meta => Key::Meta,
        K::Tab => Key::Tab,
        K::F4 => Key::F4,
        K::Escape => Key::Escape,
        K::Space => Key::Space,
        K::Q => Key::Unicode('q'),
    }
}

impl Controller {
    /// An entry of the viewer's "Sondertasten" menu – only for a shared screen (they would leave a
    /// shared window).
    fn special(&mut self, from: u64, target: Target, k: &str) {
        use crate::unattended::special::{self, Action};
        let Some(action) = special::parse(k, cfg!(target_os = "macos")) else { return };
        let fail = |c: &Self, error: &str| c.shared.send(json!({ "t": "special-error", "to": from, "k": k, "error": error }));
        if target.is_some() {
            return fail(self, "Sondertasten gehen nur, wenn der ganze Bildschirm geteilt wird.");
        }
        let link = self.shared.remote.as_ref().map(|r| r.name.clone()).unwrap_or_default();
        let result: Result<(), String> = match action {
            Action::Sas => {
                #[cfg(target_os = "windows")]
                {
                    if crate::unattended::helper() {
                        crate::unattended::client::sas()
                    } else {
                        Err("Strg+Alt+Entf geht nur über den PeekaView-Dienst („Auch ohne Anmeldung“ beim festen Link).".into())
                    }
                }
                #[cfg(not(target_os = "windows"))]
                Err("Strg+Alt+Entf gibt es nur unter Windows.".into())
            }
            Action::Lock => {
                #[cfg(target_os = "windows")]
                {
                    if unsafe { windows_sys::Win32::System::Shutdown::LockWorkStation() } != 0 {
                        Ok(())
                    } else {
                        Err("Der Rechner ließ sich nicht sperren.".into())
                    }
                }
                #[cfg(not(target_os = "windows"))]
                Err("Sperren geht hier nicht.".into())
            }
            Action::MacLock => {
                self.injected();
                if let Some(e) = self.enigo() {
                    for k in [Key::Control, Key::Meta] {
                        let _ = e.key(k, Direction::Press);
                    }
                    let _ = e.key(Key::Unicode('q'), Direction::Click);
                    for k in [Key::Meta, Key::Control] {
                        let _ = e.key(k, Direction::Release);
                    }
                }
                mac_lock_fallback()
            }
            Action::Keys(keys) => {
                self.injected();
                match self.enigo() {
                    Some(e) => {
                        for k in &keys {
                            let _ = e.key(special_key(*k), Direction::Press);
                        }
                        for k in keys.iter().rev() {
                            let _ = e.key(special_key(*k), Direction::Release);
                        }
                        Ok(())
                    }
                    None => Err("Eingaben lassen sich gerade nicht senden.".into()),
                }
            }
        };
        if crate::unattended::helper() {
            let outcome = if result.is_ok() { "" } else { " (fehlgeschlagen)" };
            crate::unattended::log::event(&link, &format!("Teilnehmer {from}"), &format!("{}{outcome}", special::label(k)));
        }
        if let Err(e) = result {
            fail(self, &e);
        }
    }

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
    fn paste(&mut self, from: u64, target: Target, v: &Value) {
        if !self.keyboard_allowed(from, target) {
            return;
        }
        // the SYSTEM helper puts no files from the network on the clipboard
        let ids: Vec<&str> = if crate::unattended::helper() { vec![] } else { v["items"].as_array().into_iter().flatten().filter_map(|i| i.as_str()).collect() };
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
    fn copy(&mut self, from: u64, target: Target, v: &Value) {
        let req = v["req"].clone();
        let reply = |shared: &Shared, body: Value| {
            let mut msg = json!({ "t": "copied", "to": from, "req": req });
            if let (Some(m), Some(b)) = (msg.as_object_mut(), body.as_object()) {
                m.extend(b.clone());
            }
            shared.send(msg);
        };
        if !self.keyboard_allowed(from, target) {
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

#[cfg(test)]
mod tests {
    use super::app_switch_dropped;

    #[test]
    fn app_switching_is_dropped_only_for_shared_windows() {
        for key in ["Tab", "Escape", " "] {
            assert!(app_switch_dropped(true, true, key), "{key:?} in a window");
            assert!(!app_switch_dropped(false, true, key), "{key:?} on a shared screen");
            assert!(!app_switch_dropped(true, false, key), "{key:?} without modifier");
        }
        assert!(!app_switch_dropped(true, true, "a"));
    }
}
