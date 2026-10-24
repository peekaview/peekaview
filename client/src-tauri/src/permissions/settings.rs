//! System Settings window metadata, also available before screen recording is authorized.

use std::ffi::c_void;

use objc2_app_kit::NSRunningApplication;
use objc2_core_foundation::{CFDictionary, CFNumber, CFNumberType, CFString, CGRect};
use objc2_core_graphics::{CGRectMakeWithDictionaryRepresentation, CGWindowListCopyWindowInfo, CGWindowListOption};
use objc2_foundation::ns_string;

use crate::guard::Rect;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct Identity {
    pid: i32,
    id: u32,
}

struct Window {
    identity: Identity,
    rect: Rect,
    visible: bool,
}

fn value(dict: &CFDictionary, key: &str) -> *const c_void {
    let key = CFString::from_str(key);
    unsafe { dict.value((key.as_ref() as *const CFString).cast()) }
}

fn number(dict: &CFDictionary, key: &str) -> Option<i32> {
    let ptr = value(dict, key) as *const CFNumber;
    if ptr.is_null() {
        return None;
    }
    let mut out = 0i32;
    unsafe { (*ptr).value(CFNumberType::IntType, (&mut out as *mut i32).cast()) }.then_some(out)
}

fn windows() -> Option<Vec<Window>> {
    objc2::rc::autoreleasepool(|_| {
        // Match the bundle identifier / PID, never a localized app name or a protected window title.
        let apps = NSRunningApplication::runningApplicationsWithBundleIdentifier(ns_string!("com.apple.systempreferences"));
        let pids: Vec<_> = apps.iter().map(|app| app.processIdentifier()).collect();
        let array = CGWindowListCopyWindowInfo(CGWindowListOption::OptionAll, 0)?;
        let mut result = Vec::new();
        for i in 0..array.count() {
            let ptr = unsafe { array.value_at_index(i) } as *const CFDictionary;
            if ptr.is_null() {
                continue;
            }
            let dict = unsafe { &*ptr };
            let Some(pid) = number(dict, "kCGWindowOwnerPID").filter(|pid| pids.contains(pid)) else { continue };
            if number(dict, "kCGWindowLayer") != Some(0) {
                continue;
            }
            let Some(id) = number(dict, "kCGWindowNumber") else { continue };
            let bounds = value(dict, "kCGWindowBounds") as *const CFDictionary;
            let mut r = CGRect::default();
            if bounds.is_null() || !unsafe { CGRectMakeWithDictionaryRepresentation(Some(&*bounds), &mut r) } || r.size.width <= 300.0 {
                continue;
            }
            let visible = value(dict, "kCGWindowIsOnscreen") as *const objc2_core_foundation::CFBoolean;
            result.push(Window {
                identity: Identity { pid, id: id as u32 },
                rect: Rect { x: r.origin.x.round() as i32, y: r.origin.y.round() as i32, w: r.size.width.round() as i32, h: r.size.height.round() as i32 },
                visible: !visible.is_null() && unsafe { (*visible).value() },
            });
        }
        Some(result)
    })
}

pub(super) struct Session {
    before: Option<Vec<Identity>>,
    target: Option<Identity>,
}

impl Session {
    pub fn new() -> Self {
        Self { before: windows().map(|list| list.into_iter().map(|w| w.identity).collect()), target: None }
    }

    pub fn follow(&mut self) -> Option<Rect> {
        let list = windows()?;
        // Follow a replacement too, but it belongs to the user after they closed our original.
        if self.target.is_some_and(|target| !list.iter().any(|w| w.identity == target)) {
            self.target = None;
            self.before = None;
        }
        if self.target.is_none() {
            self.target = list.iter().find(|w| w.visible).map(|w| w.identity);
        }
        list.into_iter().find(|w| Some(w.identity) == self.target && w.visible).map(|w| w.rect)
    }

    fn owns_target(&self) -> bool {
        self.target.is_some_and(|target| self.before.as_ref().is_some_and(|before| !before.contains(&target)))
    }

    pub fn close_owned(&self) {
        if self.owns_target() {
            let target = self.target.unwrap();
            if !crate::focus::close_window(target.pid, target.id) {
                crate::log("permissions: could not close the System Settings window opened by PeekaView");
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn closes_only_a_new_window_from_a_confirmed_snapshot() {
        let first = Identity { pid: 10, id: 20 };
        let new = Identity { pid: 10, id: 21 };
        assert!(!Session { before: Some(vec![first]), target: Some(first) }.owns_target());
        assert!(Session { before: Some(vec![first]), target: Some(new) }.owns_target());
        assert!(Session { before: Some(vec![]), target: Some(new) }.owns_target());
        assert!(!Session { before: None, target: Some(new) }.owns_target());
        assert!(!Session { before: Some(vec![]), target: None }.owns_target());
    }

    #[test]
    #[ignore = "requires a visible System Settings window and no screen recording access"]
    fn metadata_before_screen_recording_is_granted() {
        assert!(!super::super::status().screen, "run from a process without screen recording access");
        let list = windows().expect("window metadata available");
        assert!(list.iter().any(|w| w.visible && w.rect.w > 300 && w.rect.h > 0));
    }
}

/// Visible work area in Quartz points, matching Settings bounds on Retina and mixed displays.
/// AppKit must only be read from the main thread.
pub(super) fn work_area(target: Rect) -> Option<Rect> {
    let screens = objc2_app_kit::NSScreen::screens(objc2_foundation::MainThreadMarker::new()?);
    let primary_height = screens.firstObject()?.frame().size.height;
    screens.iter().map(|screen| {
        let frame = screen.visibleFrame();
        Rect { x: frame.origin.x.round() as i32,
            y: (primary_height - frame.origin.y - frame.size.height).round() as i32,
            w: frame.size.width.round() as i32, h: frame.size.height.round() as i32 }
    }).max_by_key(|r| {
        let w = ((r.x + r.w).min(target.x + target.w) - r.x.max(target.x)).max(0) as i64;
        let h = ((r.y + r.h).min(target.y + target.h) - r.y.max(target.y)).max(0) as i64;
        w * h
    })
}
