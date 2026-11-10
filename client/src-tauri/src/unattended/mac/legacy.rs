//! Input at the login window. There the agent runs as root, and macOS ignores events posted with
//! `CGEventPost` (what enigo uses) – posting with the HID system state even blocks. The older
//! `CGPostMouseEvent` / `CGPostKeyboardEvent` / `CGPostScrollWheelEvent` take effect (live test
//! with fast user switching on macOS 27). They are deprecated, but still exported.
//!
//! `Legacy` implements enigo's `Keyboard` and `Mouse`, so the controller uses it like enigo.
//! Must be used on the main thread: the key codes come from the keyboard layout (HIToolbox).

use std::{collections::HashMap, ffi::c_void};

use enigo::{Axis, Button, Coordinate, Direction, InputError, InputResult, Key, Keyboard, Mouse};

#[repr(C)]
#[derive(Clone, Copy)]
struct Point {
    x: f64,
    y: f64,
}

#[link(name = "ApplicationServices", kind = "framework")]
extern "C" {
    fn CGPostMouseEvent(at: Point, update: u32, buttons: u32, left: u32, ...) -> i32;
    fn CGPostKeyboardEvent(char_code: u16, key_code: u16, down: u32) -> i32;
    fn CGPostScrollWheelEvent(wheels: u32, vertical: i32, ...) -> i32;
    fn CGEventCreate(source: *const c_void) -> *const c_void;
    fn CGEventGetLocation(event: *const c_void) -> Point;
    fn CGMainDisplayID() -> u32;
    fn CGDisplayPixelsWide(display: u32) -> usize;
    fn CGDisplayPixelsHigh(display: u32) -> usize;
    fn CFRelease(cf: *const c_void);
    fn CFDataGetBytePtr(data: *const c_void) -> *const u8;
}

#[link(name = "Carbon", kind = "framework")]
extern "C" {
    fn TISCopyCurrentKeyboardLayoutInputSource() -> *const c_void;
    fn TISCopyCurrentASCIICapableKeyboardLayoutInputSource() -> *const c_void;
    fn TISGetInputSourceProperty(source: *const c_void, key: *const c_void) -> *const c_void;
    fn LMGetKbdType() -> u8;
    #[allow(clippy::too_many_arguments)]
    fn UCKeyTranslate(
        layout: *const u8,
        key_code: u16,
        action: u16,
        modifiers: u32,
        keyboard_type: u32,
        options: u32,
        dead_keys: *mut u32,
        max_length: usize,
        length: *mut usize,
        chars: *mut u16,
    ) -> i32;
    static kTISPropertyUnicodeKeyLayoutData: *const c_void;
}

const SHIFT: u16 = 56;
const OPTION: u16 = 58;

/// What a character needs on the current keyboard layout.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Stroke {
    pub key_code: u16,
    pub shift: bool,
    pub option: bool,
}

pub struct Legacy {
    left: bool,
    right: bool,
    keys: Option<HashMap<char, Stroke>>,
}

impl Legacy {
    pub fn new() -> Self {
        Legacy { left: false, right: false, keys: None }
    }

    fn mouse(&self, at: (i32, i32)) -> InputResult<()> {
        let at = Point { x: at.0 as f64, y: at.1 as f64 };
        match unsafe { CGPostMouseEvent(at, 1, 2, self.left as u32, self.right as u32) } {
            0 => Ok(()),
            _ => Err(InputError::Simulate("CGPostMouseEvent failed")),
        }
    }

    fn stroke(&mut self, c: char) -> Option<Stroke> {
        self.keys.get_or_insert_with(layout).get(&c).copied()
    }
}

fn post_key(char_code: u16, key_code: u16, down: bool) -> InputResult<()> {
    match unsafe { CGPostKeyboardEvent(char_code, key_code, down as u32) } {
        0 => Ok(()),
        _ => Err(InputError::Simulate("CGPostKeyboardEvent failed")),
    }
}

/// Pressed and released in order, modifiers around the key.
fn post_stroke(c: char, s: Stroke, direction: Direction) -> InputResult<()> {
    let mut units = [0u16; 2];
    let char_code = c.encode_utf16(&mut units)[0];
    let mods: Vec<u16> = [(s.shift, SHIFT), (s.option, OPTION)].iter().filter(|(on, _)| *on).map(|(_, k)| *k).collect();
    if matches!(direction, Direction::Press | Direction::Click) {
        for m in &mods {
            post_key(0, *m, true)?;
        }
        post_key(char_code, s.key_code, true)?;
    }
    if matches!(direction, Direction::Release | Direction::Click) {
        post_key(char_code, s.key_code, false)?;
        for m in mods.iter().rev() {
            post_key(0, *m, false)?;
        }
    }
    Ok(())
}

/// Character → key code and modifiers on the current keyboard layout (plain keys win over shifted
/// ones, shifted over option).
fn layout() -> HashMap<char, Stroke> {
    let mut map = HashMap::new();
    unsafe {
        let mut source = TISCopyCurrentKeyboardLayoutInputSource();
        let mut data = if source.is_null() { std::ptr::null() } else { TISGetInputSourceProperty(source, kTISPropertyUnicodeKeyLayoutData) };
        if data.is_null() {
            if !source.is_null() {
                CFRelease(source);
            }
            source = TISCopyCurrentASCIICapableKeyboardLayoutInputSource();
            data = if source.is_null() { std::ptr::null() } else { TISGetInputSourceProperty(source, kTISPropertyUnicodeKeyLayoutData) };
        }
        if data.is_null() {
            crate::log("legacy input: no keyboard layout");
            if !source.is_null() {
                CFRelease(source);
            }
            return map;
        }
        let bytes = CFDataGetBytePtr(data);
        let kind = LMGetKbdType() as u32;
        // UCKeyTranslate wants (EventModifiers >> 8) & 0xFF: shift 0x02, option 0x08
        for (shift, option) in [(false, false), (true, false), (false, true), (true, true)] {
            let modifiers = (if shift { 0x02 } else { 0 }) | (if option { 0x08 } else { 0 });
            for key_code in 0..128u16 {
                let mut dead = 0u32;
                let mut length = 0usize;
                let mut chars = [0u16; 4];
                // kUCKeyActionDown 0, kUCKeyTranslateNoDeadKeysMask 1
                if UCKeyTranslate(bytes, key_code, 0, modifiers, kind, 1, &mut dead, chars.len(), &mut length, chars.as_mut_ptr()) != 0 || length != 1 {
                    continue;
                }
                if let Some(c) = char::from_u32(chars[0] as u32).filter(|c| !c.is_control()) {
                    map.entry(c).or_insert(Stroke { key_code, shift, option });
                }
            }
        }
        CFRelease(source);
    }
    map
}

impl Keyboard for Legacy {
    fn fast_text(&mut self, _text: &str) -> InputResult<Option<()>> {
        // no fast way: `text` falls back to a key per character
        Ok(None)
    }

    fn key(&mut self, key: Key, direction: Direction) -> InputResult<()> {
        if let Key::Unicode(c) = key {
            let stroke = self.stroke(c).or_else(|| c.to_lowercase().next().filter(|l| *l != c).and_then(|l| self.stroke(l)).map(|s| Stroke { shift: true, ..s }));
            return match stroke {
                Some(s) => post_stroke(c, s, direction),
                None => Err(InputError::Mapping(format!("{c} is not on the keyboard layout"))),
            };
        }
        let key_code = u16::try_from(key).map_err(|()| InputError::Mapping(format!("{key:?}")))?;
        self.raw(key_code, direction)
    }

    fn raw(&mut self, key_code: u16, direction: Direction) -> InputResult<()> {
        if matches!(direction, Direction::Press | Direction::Click) {
            post_key(0, key_code, true)?;
        }
        if matches!(direction, Direction::Release | Direction::Click) {
            post_key(0, key_code, false)?;
        }
        Ok(())
    }
}

impl Mouse for Legacy {
    fn button(&mut self, button: Button, direction: Direction) -> InputResult<()> {
        let at = self.location()?;
        let set = |me: &mut Legacy, down: bool| match button {
            Button::Left => me.left = down,
            Button::Right => me.right = down,
            _ => {}
        };
        if !matches!(button, Button::Left | Button::Right) {
            return Err(InputError::InvalidInput("only the left and right button"));
        }
        if matches!(direction, Direction::Press | Direction::Click) {
            set(self, true);
            self.mouse(at)?;
        }
        if matches!(direction, Direction::Release | Direction::Click) {
            set(self, false);
            self.mouse(at)?;
        }
        Ok(())
    }

    fn move_mouse(&mut self, x: i32, y: i32, coordinate: Coordinate) -> InputResult<()> {
        let at = match coordinate {
            Coordinate::Abs => (x, y),
            Coordinate::Rel => {
                let (cx, cy) = self.location()?;
                (cx + x, cy + y)
            }
        };
        self.mouse(at)
    }

    fn scroll(&mut self, length: i32, axis: Axis) -> InputResult<()> {
        // enigo: positive scrolls down / right; CGPostScrollWheelEvent: positive scrolls up / left
        let r = unsafe {
            match axis {
                Axis::Vertical => CGPostScrollWheelEvent(1, -length),
                Axis::Horizontal => CGPostScrollWheelEvent(2, 0, -length),
            }
        };
        if r == 0 { Ok(()) } else { Err(InputError::Simulate("CGPostScrollWheelEvent failed")) }
    }

    fn main_display(&self) -> InputResult<(i32, i32)> {
        unsafe {
            let id = CGMainDisplayID();
            Ok((CGDisplayPixelsWide(id) as i32, CGDisplayPixelsHigh(id) as i32))
        }
    }

    fn location(&self) -> InputResult<(i32, i32)> {
        unsafe {
            let e = CGEventCreate(std::ptr::null());
            if e.is_null() {
                return Err(InputError::Simulate("no pointer position"));
            }
            let p = CGEventGetLocation(e);
            CFRelease(e);
            Ok((p.x.round() as i32, p.y.round() as i32))
        }
    }
}

#[cfg(test)]
mod tests {
    /// The keyboard layout of the test Mac has the plain letters and digits.
    #[test]
    fn layout_has_letters_and_digits() {
        let map = super::layout();
        if map.is_empty() {
            return; // no window server session (headless CI)
        }
        for c in ['a', 'x', '1', 'A'] {
            assert!(map.contains_key(&c), "{c}");
        }
        assert!(map[&'A'].shift);
        assert!(!map[&'a'].shift);
    }
}
