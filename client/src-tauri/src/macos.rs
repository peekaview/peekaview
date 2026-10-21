//! Small AppKit helpers that Tauri doesn't expose. All functions must run on the main thread.

use objc2::{msg_send, runtime::AnyObject};

// NSWindowCollectionBehavior
const CAN_JOIN_ALL_SPACES: usize = 1 << 0;
const STATIONARY: usize = 1 << 4;
const FULL_SCREEN_AUXILIARY: usize = 1 << 8;
// NSStatusWindowLevel: above normal and floating windows (e.g. System Settings)
const STATUS_LEVEL: isize = 25;

/// Raises a window above the floating ones (the red frames are floating) or back to normal.
///
/// # Safety
/// `ns_window` must be a valid NSWindow pointer; main thread only.
pub unsafe fn above_frames(ns_window: *mut std::ffi::c_void, on: bool) {
    // NSModalPanelWindowLevel: above floating windows, below the menu bar and status windows
    const MODAL_PANEL_LEVEL: isize = 8;
    let window = &*(ns_window as *const AnyObject);
    let _: () = msg_send![window, setLevel: if on { MODAL_PANEL_LEVEL } else { 0isize }];
}

/// CGWindowID of an NSWindow.
///
/// # Safety
/// `ns_window` must be a valid NSWindow pointer; main thread only.
pub unsafe fn window_number(ns_window: *mut std::ffi::c_void) -> u32 {
    let window = &*(ns_window as *const AnyObject);
    let number: isize = msg_send![window, windowNumber];
    number as u32
}

/// Keeps a window visible above everything – on every Space and next to full-screen apps –
/// without activating the app.
///
/// # Safety
/// `ns_window` must be a valid NSWindow pointer; main thread only.
pub unsafe fn keep_in_front(ns_window: *mut std::ffi::c_void) {
    let window = &*(ns_window as *const AnyObject);
    let _: () = msg_send![window, setLevel: STATUS_LEVEL];
    let _: () = msg_send![window, setCollectionBehavior: CAN_JOIN_ALL_SPACES | STATIONARY | FULL_SCREEN_AUXILIARY];
    let _: () = msg_send![window, orderFrontRegardless];
}
