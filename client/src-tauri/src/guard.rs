//! Keeps viewer input inside the shared windows.
//!
//! A target is a shared window plus the process that owns it: the app's own dialogs, sheets and
//! menus on top of the window count as part of it.
//!
//! Before any injected click/scroll we verify that the shared window is the topmost window
//! at that screen point – it may lie in the background, but that spot must not be covered –
//! and that it is none of PeekaView's own windows; before any injected keystroke we verify that
//! the shared window owns the keyboard focus (a viewer's click into it gives it the focus).
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

    /// The part of this rect that lies within `other`, if any.
    pub fn intersect(&self, other: &Rect) -> Option<Rect> {
        let (x, y) = (self.x.max(other.x), self.y.max(other.y));
        let (r, b) = ((self.x + self.w).min(other.x + other.w), (self.y + self.h).min(other.y + other.h));
        (r > x && b > y).then_some(Rect { x, y, w: r - x, h: b - y })
    }

    /// [x, y, w, h] relative to `outer` (0..1 inside it), to 4 decimals.
    pub fn within(&self, outer: &Rect) -> [f64; 4] {
        let round = |v: f64| (v * 10_000.0).round() / 10_000.0;
        let (w, h) = (outer.w.max(1) as f64, outer.h.max(1) as f64);
        [round((self.x - outer.x) as f64 / w), round((self.y - outer.y) as f64 / h), round(self.w as f64 / w), round(self.h as f64 / h)]
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

/// CGWindowIDs of our click-through overlays (macOS), which never block input.
#[cfg(target_os = "macos")]
pub static OVERLAY_WINDOWS: std::sync::Mutex<Vec<u32>> = std::sync::Mutex::new(Vec::new());

/// A shared window: (window id, owning process id).
pub type Target = Option<(u32, i32)>;

/// May viewer input land at screen point (x, y)? Never on one of PeekaView's own windows
/// (main window, helpers); with a shared window (`target`) only if that window – or a dialog / menu
/// of its app – is topmost there.
pub fn input_allowed(target: Target, x: i32, y: i32) -> bool {
    imp::any_allowed(target, &[(x, y)])
}

/// Is the shared window in front – no other app's window lying over any part of it (PeekaView's
/// own windows and the window's own dialogs aside)? Always true where the platform does not tell.
pub fn in_front(target: Target) -> bool {
    #[cfg(target_os = "macos")]
    return imp::in_front(target);
    #[cfg(not(target_os = "macos"))]
    {
        let _ = target;
        true
    }
}

/// Can viewers reach the shared window at all, i.e. is some part of it not covered?
/// Samples a grid over `rect`; always true for a shared screen.
pub fn reachable(target: Target, rect: Rect) -> bool {
    if target.is_none() {
        return true;
    }
    let points: Vec<(i32, i32)> = (0..GRID)
        .flat_map(|i| (0..GRID).map(move |j| ((i as f64 + 0.5) / GRID as f64, (j as f64 + 0.5) / GRID as f64)))
        .map(|(nx, ny)| rect.point(nx, ny))
        .collect();
    imp::any_allowed(target, &points)
}

const GRID: usize = 5;

/// The parts of the shared window that other windows lie over (screen coordinates, clipped to
/// `rect`): viewer input is refused there. Empty for a shared screen and where the platform does
/// not tell.
pub fn covers(target: Target, rect: Rect) -> Vec<Rect> {
    if target.is_none() {
        return vec![];
    }
    let mut out: Vec<Rect> = imp::covers(target).iter().filter_map(|r| r.intersect(&rect)).filter(|r| r.w >= MIN_COVER && r.h >= MIN_COVER).collect();
    out.truncate(MAX_COVERS);
    out
}

/// Slivers (window shadows, 1 px borders) are not worth showing.
const MIN_COVER: i32 = 4;
const MAX_COVERS: usize = 32;

/// Windows of the shared window's app that are *not* part of it (other document windows, the
/// Finder's desktop) – they are left out of the picture. Part of it: menus and panels above the
/// normal window level, and windows lying within it (sheets, dialogs). macOS only.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub fn foreign_windows_of_app(window_id: u32) -> Vec<u32> {
    #[cfg(target_os = "macos")]
    {
        let windows = imp::list(true);
        let Some(target) = windows.iter().find(|w| w.id == window_id) else { return vec![] };
        return windows.iter().filter(|w| w.pid == target.pid && w.id != window_id && !imp::part_of(w, &target.rect)).map(|w| w.id).collect();
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = window_id;
        vec![]
    }
}

/// Window ids front to back (where the platform tells).
pub fn stack_order() -> Option<Vec<u32>> {
    #[cfg(target_os = "macos")]
    return Some(imp::list(false).into_iter().filter(|w| w.layer == 0).map(|w| w.id).collect());
    #[cfg(not(target_os = "macos"))]
    None
}

/// Set while the window overview is open (or just closing): the picture shows thumbnails then,
/// so no frames are sent – viewers keep the last real one.
pub static OVERVIEW_ACTIVE: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// Is the presenter's window overview open (macOS Mission Control / App Exposé)? Meanwhile the
/// window list reports the thumbnails' frames instead of the windows' own.
pub fn overview() -> bool {
    #[cfg(target_os = "macos")]
    return imp::overview();
    #[cfg(not(target_os = "macos"))]
    false
}

/// May PeekaView control mouse and keyboard (macOS "Bedienungshilfen")?
pub fn accessibility() -> bool {
    crate::permissions::granted("accessibility")
}

/// Does the shared window (or a dialog of its app on top of it) receive keyboard input?
pub fn focused(target: (u32, i32)) -> bool {
    imp::focused(target)
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

    /// The Dock shows the overview in windows of their own, on level 18 above everything.
    pub fn overview() -> bool {
        let Some(array) = CGWindowListCopyWindowInfo(CGWindowListOption::OptionOnScreenOnly, 0) else {
            return false;
        };
        (0..array.count()).any(|i| {
            let ptr = unsafe { array.value_at_index(i) } as *const CFDictionary;
            if ptr.is_null() {
                return false;
            }
            let dict = unsafe { &*ptr };
            let owner = value(dict, "kCGWindowOwnerName") as *const CFString;
            number::<i32>(dict, "kCGWindowLayer", CFNumberType::IntType) == Some(18)
                && !owner.is_null()
                && unsafe { (*owner).to_string() } == "Dock"
        })
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

    /// Is input allowed at any of the points? One window list for all of them.
    pub fn in_front(target: super::Target) -> bool {
        let Some((id, pid)) = target else { return true };
        let me = std::process::id() as i32;
        let windows = list(false);
        let displays = displays();
        let Some(own) = windows.iter().find(|w| w.id == id).map(|w| w.rect) else { return true };
        // front to back, until the window itself: nothing of another app over it
        !windows
            .iter()
            .take_while(|w| w.id != id)
            .filter(|w| w.alpha > 0.0 && w.pid != me && !is_screen_overlay(w, &displays))
            .any(|w| overlaps(&w.rect, &own) && !(w.pid == pid && part_of(w, &own)))
    }

    /// Windows lying over the shared one, as `any_allowed` judges them: PeekaView's own windows
    /// count (input is never allowed there), its click-through overlays and the window's own
    /// dialogs / menus do not.
    pub fn covers(target: super::Target) -> Vec<Rect> {
        let Some((id, pid)) = target else { return vec![] };
        let overlays = super::OVERLAY_WINDOWS.lock().unwrap().clone();
        let windows = list(false);
        let displays = displays();
        let Some(own) = windows.iter().find(|w| w.id == id).map(|w| w.rect) else { return vec![] };
        windows
            .iter()
            .take_while(|w| w.id != id)
            .filter(|w| w.alpha > 0.0 && !overlays.contains(&w.id) && !is_screen_overlay(w, &displays))
            .filter(|w| !(w.pid == pid && part_of(w, &own)))
            .map(|w| w.rect)
            .collect()
    }

    pub fn any_allowed(target: super::Target, points: &[(i32, i32)]) -> bool {
        let me = std::process::id() as i32;
        let overlays = super::OVERLAY_WINDOWS.lock().unwrap().clone();
        let is_overlay = |id: u32| overlays.contains(&id);
        let windows = list(false);
        let displays = if target.is_some() { displays() } else { Vec::new() };
        points.iter().any(|&(x, y)| {
            // never on one of our own windows (main window, helpers) – the overlay is click-through
            if windows.iter().any(|w| w.pid == me && !is_overlay(w.id) && w.alpha > 0.0 && w.rect.contains(x, y)) {
                return false;
            }
            let Some((id, pid)) = target else { return true };
            let Some(own) = windows.iter().find(|w| w.id == id).map(|w| w.rect) else { return false };
            // front to back: the first visible window at that point must be the shared one or
            // one of its own dialogs / menus (not another window of the same app)
            windows
                .iter()
                .filter(|w| w.alpha > 0.0 && !is_overlay(w.id) && !is_screen_overlay(w, &displays))
                .find(|w| w.rect.contains(x, y))
                .is_some_and(|w| w.id == id || (w.pid == pid && part_of(w, &own)))
        })
    }

    pub fn focused((window_id, _): (u32, i32)) -> bool {
        let windows = list(false);
        let Some(target) = windows.iter().find(|w| w.id == window_id) else { return false };
        // the owning app must be the active one …
        let active = xcap::Window::all()
            .ok()
            .and_then(|all| all.into_iter().find(|w| w.id().ok() == Some(window_id)))
            .and_then(|w| w.is_focused().ok())
            .unwrap_or(false);
        // … and within that app the frontmost window must be the shared one or a dialog on it
        active
            && windows
                .iter()
                .find(|w| w.pid == target.pid && w.layer >= 0 && w.alpha > 0.0 && w.rect.w > 50 && w.rect.h > 50)
                .is_some_and(|w| w.id == window_id || overlaps(&w.rect, &target.rect))
    }

    /// A window of the shared window's app that belongs to it: a menu / panel (above the normal
    /// level) or a sheet / dialog lying within it.
    pub(super) fn part_of(w: &Info, target: &Rect) -> bool {
        if w.layer < 0 {
            return false; // e.g. the Finder's desktop
        }
        if w.layer > 0 {
            return true;
        }
        let m = 40;
        w.rect.x >= target.x - m && w.rect.y >= target.y - m && w.rect.x + w.rect.w <= target.x + target.w + m && w.rect.y + w.rect.h <= target.y + target.h + m
    }

    fn overlaps(a: &Rect, b: &Rect) -> bool {
        a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
    }
}

#[cfg(target_os = "windows")]
mod imp {
    use std::ffi::c_void;

    use windows_sys::core::BOOL;
    use windows_sys::Win32::{
        Foundation::{HWND, LPARAM, POINT, RECT},
        Graphics::Dwm::{DwmGetWindowAttribute, DWMWA_CLOAKED, DWMWA_EXTENDED_FRAME_BOUNDS},
        UI::WindowsAndMessaging::{
            EnumWindows, GetAncestor, GetForegroundWindow, GetWindowLongW, GetWindowRect, GetWindowThreadProcessId, IsIconic, IsWindowVisible,
            WindowFromPoint, GA_ROOT, GWL_EXSTYLE, WS_EX_LAYERED, WS_EX_TRANSPARENT,
        },
    };

    use super::Rect;

    struct Walk {
        id: u32,
        owner: i32,
        out: Vec<Rect>,
    }

    /// One top-level window, front to back – until the shared one.
    unsafe extern "system" fn each(hwnd: HWND, data: LPARAM) -> BOOL {
        let walk = unsafe { &mut *(data as *mut Walk) };
        if hwnd as usize as u32 == walk.id {
            return 0;
        }
        if unsafe { IsWindowVisible(hwnd) } == 0 || unsafe { IsIconic(hwnd) } != 0 {
            return 1;
        }
        // click-through windows (our overlays) never take input – WindowFromPoint skips them too
        let ex = unsafe { GetWindowLongW(hwnd, GWL_EXSTYLE) } as u32;
        if ex & WS_EX_LAYERED != 0 && ex & WS_EX_TRANSPARENT != 0 {
            return 1;
        }
        // windows of other virtual desktops and suspended store apps are "cloaked"
        let mut cloaked = 0u32;
        if unsafe { DwmGetWindowAttribute(hwnd, DWMWA_CLOAKED as _, &mut cloaked as *mut u32 as *mut c_void, 4) } == 0 && cloaked != 0 {
            return 1;
        }
        // the shared window's own dialogs and menus count as part of it
        let mut pid = 0u32;
        unsafe { GetWindowThreadProcessId(hwnd, &mut pid) };
        if pid as i32 == walk.owner {
            return 1;
        }
        // the visible frame, without the invisible resize borders
        let mut r = RECT { left: 0, top: 0, right: 0, bottom: 0 };
        let frame = unsafe { DwmGetWindowAttribute(hwnd, DWMWA_EXTENDED_FRAME_BOUNDS as _, &mut r as *mut RECT as *mut c_void, std::mem::size_of::<RECT>() as u32) };
        if frame != 0 && unsafe { GetWindowRect(hwnd, &mut r) } == 0 {
            return 1;
        }
        walk.out.push(Rect { x: r.left, y: r.top, w: r.right - r.left, h: r.bottom - r.top });
        1
    }

    pub fn covers(target: super::Target) -> Vec<Rect> {
        let Some((id, owner)) = target else { return vec![] };
        let mut walk = Walk { id, owner, out: Vec::new() };
        unsafe { EnumWindows(Some(each), &mut walk as *mut Walk as LPARAM) };
        walk.out
    }

    pub fn window_geometry(win: &xcap::Window) -> Option<(Rect, bool)> {
        let rect = Rect { x: win.x().ok()?, y: win.y().ok()?, w: win.width().ok()? as i32, h: win.height().ok()? as i32 };
        Some((rect, !win.is_minimized().unwrap_or(true)))
    }

    fn input_allowed(target: super::Target, x: i32, y: i32) -> bool {
        // WindowFromPoint skips click-through (layered + transparent) windows like our overlay.
        let root = unsafe { GetAncestor(WindowFromPoint(POINT { x, y }), GA_ROOT) };
        if root.is_null() {
            return target.is_none();
        }
        let mut pid = 0u32;
        unsafe { GetWindowThreadProcessId(root, &mut pid) };
        // the shared window itself or a dialog / menu of its process
        pid != std::process::id() && target.is_none_or(|(id, owner)| root as usize as u32 == id || pid as i32 == owner)
    }

    pub fn any_allowed(target: super::Target, points: &[(i32, i32)]) -> bool {
        points.iter().any(|&(x, y)| input_allowed(target, x, y))
    }

    pub fn focused((window_id, owner): (u32, i32)) -> bool {
        let fg = unsafe { GetForegroundWindow() };
        if fg.is_null() {
            return false;
        }
        let mut pid = 0u32;
        unsafe { GetWindowThreadProcessId(fg, &mut pid) };
        fg as usize as u32 == window_id || pid as i32 == owner
    }
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
mod imp {
    use super::Rect;

    pub fn covers(_target: super::Target) -> Vec<Rect> {
        vec![]
    }

    pub fn window_geometry(win: &xcap::Window) -> Option<(Rect, bool)> {
        let rect = Rect { x: win.x().ok()?, y: win.y().ok()?, w: win.width().ok()? as i32, h: win.height().ok()? as i32 };
        Some((rect, !win.is_minimized().unwrap_or(true)))
    }

    fn input_allowed(target: super::Target, x: i32, y: i32) -> bool {
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
            Some(w) => w.pid().ok() != Some(me) && target.is_none_or(|(id, owner)| w.id().ok() == Some(id) || w.pid().ok() == Some(owner as u32)),
        }
    }

    pub fn any_allowed(target: super::Target, points: &[(i32, i32)]) -> bool {
        points.iter().any(|&(x, y)| input_allowed(target, x, y))
    }

    pub fn focused((window_id, _): (u32, i32)) -> bool {
        xcap::Window::all()
            .ok()
            .and_then(|all| all.into_iter().find(|w| w.id().ok() == Some(window_id)))
            .and_then(|w| w.is_focused().ok())
            .unwrap_or(false)
    }
}

#[cfg(test)]
mod rect_tests {
    use super::Rect;

    #[test]
    fn intersect_clips_to_the_window() {
        let win = Rect { x: 100, y: 100, w: 400, h: 300 };
        let over = Rect { x: 350, y: 50, w: 400, h: 150 };
        assert_eq!(over.intersect(&win), Some(Rect { x: 350, y: 100, w: 150, h: 100 }));
        // only touching or apart: nothing covered
        assert_eq!(Rect { x: 500, y: 100, w: 50, h: 50 }.intersect(&win), None);
        assert_eq!(Rect { x: 0, y: 0, w: 50, h: 50 }.intersect(&win), None);
    }

    #[test]
    fn within_normalizes_to_the_window() {
        let win = Rect { x: 100, y: 100, w: 400, h: 300 };
        assert_eq!(Rect { x: 350, y: 100, w: 150, h: 100 }.within(&win), [0.625, 0.0, 0.375, 0.3333]);
        assert_eq!(win.within(&win), [0.0, 0.0, 1.0, 1.0]);
    }
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    /// Diagnostic against the live desktop: `PV_WINDOW=<title> cargo test guard -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn live_window_checks() {
        let title = std::env::var("PV_WINDOW").unwrap_or_else(|_| "Ohne Titel".into());
        let wanted: Option<u32> = std::env::var("PV_WINDOW_ID").ok().and_then(|v| v.parse().ok());
        let win = xcap::Window::all()
            .unwrap()
            .into_iter()
            .find(|w| match wanted {
                Some(id) => w.id().ok() == Some(id),
                None => w.title().ok().as_deref() == Some(title.as_str()),
            })
            .expect("window");
        let id = win.id().unwrap();
        println!("app={:?} title={:?} pid={:?} xcap focused={:?}", win.app_name(), win.title(), win.pid(), win.is_focused());
        let (rect, visible) = super::window_geometry(&win).unwrap();
        let (cx, cy) = rect.point(0.5, 0.6);
        let target = (id, win.pid().unwrap_or(0) as i32);
        println!("window {id} {rect:?} visible={visible} focused={}", super::focused(target));
        println!("input_allowed(center)={} reachable={}", super::input_allowed(Some(target), cx, cy), super::reachable(Some(target), rect));
        for c in super::covers(Some(target), rect) {
            println!("  covered: {c:?} = {:?}", c.within(&rect));
        }
        for w in super::imp::list(false).iter().filter(|w| w.rect.contains(cx, cy)) {
            println!("  at center: id={} pid={} layer={} alpha={} {:?}", w.id, w.pid, w.layer, w.alpha, w.rect);
        }
    }
}
