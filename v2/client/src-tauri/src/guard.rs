//! Keeps viewer input inside the shared window.
//!
//! Before any injected click/scroll we verify that the shared window is the topmost window
//! at that screen point (so nothing lying on top of it can be hit) and that it is none of
//! PeekaView's own windows; before any injected keystroke we verify that the shared window owns
//! the keyboard focus.
//! All coordinates are in the platform's input space (macOS: points, Windows: physical pixels).

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Rect {
    pub x: i32,
    pub y: i32,
    pub w: i32,
    pub h: i32,
}

impl Rect {
    /// Map normalized (0..1) coordinates into this rect, clamped to its inside.
    pub fn point(&self, nx: f64, ny: f64) -> (i32, i32) {
        let nx = if nx.is_finite() { nx.clamp(0.0, 1.0) } else { 0.5 };
        let ny = if ny.is_finite() { ny.clamp(0.0, 1.0) } else { 0.5 };
        (
            self.x + ((self.w - 1).max(0) as f64 * nx).round() as i32,
            self.y + ((self.h - 1).max(0) as f64 * ny).round() as i32,
        )
    }

    pub fn contains(&self, x: i32, y: i32) -> bool {
        x >= self.x && y >= self.y && x < self.x + self.w && y < self.y + self.h
    }
}

/// Current geometry of a window: `None` if it no longer exists, `Some((rect, visible))` otherwise.
pub fn window_geometry(win: &xcap::Window) -> Option<(Rect, bool)> {
    imp::window_geometry(win)
}

/// Ids of ordinary app windows (macOS: window level 0, i.e. no Dock, menu bar, notifications,
/// system dialogs). `None` where the platform's window list needs no such filter.
pub fn normal_window_ids() -> Option<std::collections::HashSet<u32>> {
    #[cfg(target_os = "macos")]
    return Some(imp::list(false).into_iter().filter(|w| w.layer == 0 && w.alpha > 0.0).map(|w| w.id).collect());
    #[cfg(not(target_os = "macos"))]
    None
}

/// CGWindowID of our click-through overlay (macOS), which never blocks input.
#[cfg(target_os = "macos")]
pub static OVERLAY_WINDOW: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);

/// May viewer input land at screen point (x, y)? Never on one of PeekaView's own windows
/// (toolbar, helpers); with a shared window (`target`) only if that window is topmost there.
pub fn input_allowed(target: Option<u32>, x: i32, y: i32) -> bool {
    imp::input_allowed(target, x, y)
}

/// Does `window_id` currently receive keyboard input?
pub fn focused(window_id: u32) -> bool {
    imp::focused(window_id)
}

#[cfg(target_os = "macos")]
mod imp {
    use std::ffi::c_void;

    use objc2_core_foundation::{CFDictionary, CFNumber, CFNumberType, CFString, CGRect};
    use objc2_core_graphics::{CGRectMakeWithDictionaryRepresentation, CGWindowListCopyWindowInfo, CGWindowListOption};

    use super::Rect;

    #[derive(Debug)]
    pub(super) struct Info {
        pub id: u32,
        pub pid: i32,
        pub layer: i32,
        pub alpha: f64,
        pub on_screen: bool,
        pub rect: Rect,
    }

    fn value(dict: &CFDictionary, key: &str) -> *const c_void {
        let key = CFString::from_str(key);
        unsafe { dict.value((key.as_ref() as *const CFString).cast()) }
    }

    fn number<T: Default>(dict: &CFDictionary, key: &str, kind: CFNumberType) -> Option<T> {
        let ptr = value(dict, key) as *const CFNumber;
        if ptr.is_null() {
            return None;
        }
        let mut out = T::default();
        unsafe { (*ptr).value(kind, &mut out as *mut T as *mut c_void) }.then_some(out)
    }

    /// Windows front to back; `all` also lists minimized / hidden ones.
    pub(super) fn list(all: bool) -> Vec<Info> {
        let mut out = Vec::new();
        let option = if all {
            CGWindowListOption::OptionAll
        } else {
            CGWindowListOption::OptionOnScreenOnly | CGWindowListOption::ExcludeDesktopElements
        };
        let Some(array) = CGWindowListCopyWindowInfo(option, 0) else {
            return out;
        };
        for i in 0..array.count() {
            let ptr = unsafe { array.value_at_index(i) } as *const CFDictionary;
            if ptr.is_null() {
                continue;
            }
            let dict = unsafe { &*ptr };
            let bounds = value(dict, "kCGWindowBounds") as *const CFDictionary;
            let mut r = CGRect::default();
            if bounds.is_null() || !unsafe { CGRectMakeWithDictionaryRepresentation(Some(&*bounds), &mut r) } {
                continue;
            }
            let on_screen = value(dict, "kCGWindowIsOnscreen");
            out.push(Info {
                id: number::<i32>(dict, "kCGWindowNumber", CFNumberType::IntType).unwrap_or(0) as u32,
                pid: number(dict, "kCGWindowOwnerPID", CFNumberType::IntType).unwrap_or(0),
                layer: number(dict, "kCGWindowLayer", CFNumberType::IntType).unwrap_or(0),
                alpha: number(dict, "kCGWindowAlpha", CFNumberType::Float64Type).unwrap_or(1.0),
                on_screen: !on_screen.is_null()
                    && unsafe { (*(on_screen as *const objc2_core_foundation::CFBoolean)).value() },
                rect: Rect {
                    x: r.origin.x.round() as i32,
                    y: r.origin.y.round() as i32,
                    w: r.size.width.round() as i32,
                    h: r.size.height.round() as i32,
                },
            });
        }
        out
    }

    pub fn window_geometry(win: &xcap::Window) -> Option<(Rect, bool)> {
        let id = win.id().ok()?;
        // minimized windows or windows on another Space exist but are not on screen
        list(true).into_iter().find(|w| w.id == id).map(|w| (w.rect, w.on_screen))
    }

    /// Invisible system overlays that span a whole display (e.g. one of the Dock's) are
    /// skipped; any other window on top blocks – also banners, menus and Spotlight on higher levels.
    fn is_screen_overlay(w: &Info, displays: &[Rect]) -> bool {
        w.layer != 0 && displays.iter().any(|d| w.rect.x <= d.x && w.rect.y <= d.y && w.rect.x + w.rect.w >= d.x + d.w && w.rect.y + w.rect.h >= d.y + d.h)
    }

    fn displays() -> Vec<Rect> {
        xcap::Monitor::all()
            .unwrap_or_default()
            .iter()
            .filter_map(|m| Some(Rect { x: m.x().ok()?, y: m.y().ok()?, w: m.width().ok()? as i32, h: m.height().ok()? as i32 }))
            .collect()
    }

    pub fn input_allowed(target: Option<u32>, x: i32, y: i32) -> bool {
        let me = std::process::id() as i32;
        let overlay = super::OVERLAY_WINDOW.load(std::sync::atomic::Ordering::Relaxed);
        let windows = list(false);
        // never on one of our own windows (toolbar, helpers) – the overlay is click-through
        if windows.iter().any(|w| w.pid == me && w.id != overlay && w.alpha > 0.0 && w.rect.contains(x, y)) {
            return false;
        }
        let Some(id) = target else { return true };
        let displays = displays();
        // front to back: the first visible window at that point must be the shared one
        windows
            .iter()
            .filter(|w| w.alpha > 0.0 && w.id != overlay && !is_screen_overlay(w, &displays))
            .find(|w| w.rect.contains(x, y))
            .is_some_and(|w| w.id == id)
    }

    pub fn focused(window_id: u32) -> bool {
        let windows = list(false);
        let Some(target) = windows.iter().find(|w| w.id == window_id) else { return false };
        // the owning app must be the active one …
        let active = xcap::Window::all()
            .ok()
            .and_then(|all| all.into_iter().find(|w| w.id().ok() == Some(window_id)))
            .and_then(|w| w.is_focused().ok())
            .unwrap_or(false);
        // … and within that app the shared window must be the frontmost normal window
        active
            && windows
                .iter()
                .find(|w| w.pid == target.pid && w.layer == 0 && w.alpha > 0.0 && w.rect.w > 50 && w.rect.h > 50)
                .map(|w| w.id)
                == Some(window_id)
    }
}

#[cfg(target_os = "windows")]
mod imp {
    use windows_sys::Win32::{
        Foundation::POINT,
        UI::WindowsAndMessaging::{GetAncestor, GetForegroundWindow, GetWindowThreadProcessId, WindowFromPoint, GA_ROOT},
    };

    use super::Rect;

    pub fn window_geometry(win: &xcap::Window) -> Option<(Rect, bool)> {
        let rect = Rect { x: win.x().ok()?, y: win.y().ok()?, w: win.width().ok()? as i32, h: win.height().ok()? as i32 };
        Some((rect, !win.is_minimized().unwrap_or(true)))
    }

    pub fn input_allowed(target: Option<u32>, x: i32, y: i32) -> bool {
        // WindowFromPoint skips click-through (layered + transparent) windows like our overlay.
        let root = unsafe { GetAncestor(WindowFromPoint(POINT { x, y }), GA_ROOT) };
        if root.is_null() {
            return target.is_none();
        }
        let mut pid = 0u32;
        unsafe { GetWindowThreadProcessId(root, &mut pid) };
        pid != std::process::id() && target.is_none_or(|id| root as usize as u32 == id)
    }

    pub fn focused(window_id: u32) -> bool {
        let fg = unsafe { GetForegroundWindow() };
        !fg.is_null() && fg as usize as u32 == window_id
    }
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
mod imp {
    use super::Rect;

    pub fn window_geometry(win: &xcap::Window) -> Option<(Rect, bool)> {
        let rect = Rect { x: win.x().ok()?, y: win.y().ok()?, w: win.width().ok()? as i32, h: win.height().ok()? as i32 };
        Some((rect, !win.is_minimized().unwrap_or(true)))
    }

    pub fn input_allowed(target: Option<u32>, x: i32, y: i32) -> bool {
        let me = std::process::id();
        let Ok(mut all) = xcap::Window::all() else { return false };
        all.sort_by_key(|w| std::cmp::Reverse(w.z().unwrap_or(i32::MIN)));
        let top = all
            .into_iter()
            .filter(|w| !(w.pid().ok() == Some(me) && w.title().ok().as_deref() == Some(crate::OVERLAY_TITLE)))
            .filter(|w| !w.is_minimized().unwrap_or(true))
            .find(|w| {
                let r = Rect {
                    x: w.x().unwrap_or(0),
                    y: w.y().unwrap_or(0),
                    w: w.width().unwrap_or(0) as i32,
                    h: w.height().unwrap_or(0) as i32,
                };
                r.contains(x, y)
            });
        match top {
            None => target.is_none(),
            Some(w) => w.pid().ok() != Some(me) && target.is_none_or(|id| w.id().ok() == Some(id)),
        }
    }

    pub fn focused(window_id: u32) -> bool {
        xcap::Window::all()
            .ok()
            .and_then(|all| all.into_iter().find(|w| w.id().ok() == Some(window_id)))
            .and_then(|w| w.is_focused().ok())
            .unwrap_or(false)
    }
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    /// Diagnostic against the live desktop: `PV_WINDOW=<title> cargo test guard -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn live_window_checks() {
        let title = std::env::var("PV_WINDOW").unwrap_or_else(|_| "Ohne Titel".into());
        let win = xcap::Window::all().unwrap().into_iter().find(|w| w.title().ok().as_deref() == Some(title.as_str())).expect("window");
        let id = win.id().unwrap();
        let (rect, visible) = super::window_geometry(&win).unwrap();
        let (cx, cy) = rect.point(0.5, 0.6);
        println!("window {id} {rect:?} visible={visible} focused={}", super::focused(id));
        println!("input_allowed(center)={}", super::input_allowed(Some(id), cx, cy));
        for w in super::imp::list(false).iter().filter(|w| w.rect.contains(cx, cy)) {
            println!("  at center: id={} pid={} layer={} alpha={} {:?}", w.id, w.pid, w.layer, w.alpha, w.rect);
        }
    }
}
