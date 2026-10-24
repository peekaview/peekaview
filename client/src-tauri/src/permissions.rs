//! macOS privacy permissions: screen recording (always needed) and accessibility (remote control).
//!
//! When one is missing we open the matching System Settings pane and dock a small helper window
//! next to it, from which the app can be dragged into the list.

use serde::Serialize;
use tauri::{AppHandle, Manager};
#[cfg(target_os = "macos")]
use tauri::{Emitter, WebviewUrl, WebviewWindowBuilder};

#[derive(Serialize)]
pub struct Status {
    screen: bool,
    accessibility: bool,
    #[serde(rename = "accessibilityRequired")]
    accessibility_required: bool,
}

#[cfg(target_os = "macos")]
mod sys {
    #[link(name = "ApplicationServices", kind = "framework")]
    extern "C" {
        pub fn CGPreflightScreenCaptureAccess() -> bool;
        pub fn AXIsProcessTrusted() -> bool;
    }
}

pub fn status() -> Status {
    #[cfg(target_os = "macos")]
    unsafe {
        Status { screen: sys::CGPreflightScreenCaptureAccess(), accessibility: sys::AXIsProcessTrusted(), accessibility_required: ACCESSIBILITY_REQUIRED.load(std::sync::atomic::Ordering::SeqCst) }
    }
    #[cfg(not(target_os = "macos"))]
    Status { screen: true, accessibility: true, accessibility_required: false }
}

pub fn ready() -> bool {
    let s = status();
    required_granted(s.screen, s.accessibility, false)
}

pub fn ready_for_request() -> bool {
    let s = status();
    required_granted(s.screen, s.accessibility, s.accessibility_required)
}

fn required_granted(screen: bool, accessibility: bool, control: bool) -> bool {
    screen && (!control || accessibility)
}

/// The installed app bundle (or the bare binary in development).
#[cfg(target_os = "macos")]
fn app_path() -> Option<std::path::PathBuf> {
    let exe = std::env::current_exe().ok()?;
    Some(exe.ancestors().find(|p| p.extension().is_some_and(|e| e == "app")).map(|p| p.to_path_buf()).unwrap_or(exe))
}

const HELPER: &str = "permission";
#[cfg(target_os = "macos")]
const TARGET: &str = "permission-target";
#[cfg(target_os = "macos")]
static ACCESSIBILITY_REQUIRED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
#[cfg(target_os = "macos")]
const HELPER_SIZE: (f64, f64) = (360.0, 550.0);

fn kind_of(kind: &str) -> &'static str {
    if kind == "accessibility" { "accessibility" } else { "screen" }
}

pub fn granted(kind: &str) -> bool {
    let s = status();
    if kind_of(kind) == "accessibility" { s.accessibility } else { s.screen }
}

// Tauri's macOS theme is app-wide; keep the companion independent of it.
#[cfg(target_os = "macos")]
fn follow_system_appearance(window: &tauri::WebviewWindow) {
    use objc2_app_kit::{NSAppearance, NSAppearanceCustomization, NSAppearanceNameAqua, NSAppearanceNameDarkAqua, NSWindow};
    use objc2_foundation::{ns_string, NSUserDefaults};
    let Ok(raw) = window.ns_window() else { return };
    let window = unsafe { &*raw.cast::<NSWindow>() };
    let dark = NSUserDefaults::standardUserDefaults().stringForKey(ns_string!("AppleInterfaceStyle"))
        .is_some_and(|style| style.to_string() == "Dark");
    let name = unsafe { if dark { NSAppearanceNameDarkAqua } else { NSAppearanceNameAqua } };
    if window.appearance().is_none_or(|appearance| &*appearance.name() != name) {
        window.setAppearance(Some(&NSAppearance::appearanceNamed(name).expect("macOS system appearance")));
    }
}

/// Missing permissions in the order they are asked for: accessibility first (works right away),
/// screen recording last (macOS applies it only after a restart of the app).
#[cfg(target_os = "macos")]
fn missing() -> Vec<&'static str> {
    let s = status();
    let mut list = Vec::new();
    if s.accessibility_required && !s.accessibility {
        list.push("accessibility");
    }
    if !s.screen {
        list.push("screen");
    }
    list
}

/// The helper may be closed once sharing is possible (screen recording granted).
pub fn may_close() -> bool {
    status().screen
}

/// Remote control was switched off again: a helper that only waits for accessibility goes.
pub fn dismiss(app: &AppHandle, kind: &str) {
    if kind_of(kind) == "accessibility" && status().screen {
        if let Some(window) = app.get_webview_window(HELPER) {
            let _ = window.destroy();
        }
    }
}

/// Permissions for the requested feature: one helper window, docked to System Settings (it
/// follows the window), opens the pane of each missing permission in turn and goes once all are
/// granted. Accessibility is required only when remote control was requested.
pub fn request(app: &AppHandle, kind: &str) {
    #[cfg(target_os = "macos")]
    {
        if let Some(existing) = app.get_webview_window(HELPER) {
            if kind_of(kind) == "accessibility" { ACCESSIBILITY_REQUIRED.store(true, std::sync::atomic::Ordering::SeqCst); }
            let _ = existing.show();
            let _ = existing.set_focus();
            return;
        }
        ACCESSIBILITY_REQUIRED.store(kind_of(kind) == "accessibility", std::sync::atomic::Ordering::SeqCst);
        if missing().is_empty() { return; }
        if let Err(error) = crate::resume::begin_permissions(app) {
            crate::log(&format!("permissions: {error}"));
            return;
        }
        let needs_restart = !status().screen;
        crate::set_dock(app, true);
        let Ok(window) = WebviewWindowBuilder::new(app, HELPER, WebviewUrl::App("desktop/permission.html".into()))
            .title("PeekaView freischalten")
            .inner_size(HELPER_SIZE.0, HELPER_SIZE.1)
            .resizable(false)
            .minimizable(false)
            .always_on_top(true)
            .visible_on_all_workspaces(true)
            .visible(false)
            .build()
        else {
            return;
        };
        let target = WebviewWindowBuilder::new(app, TARGET, WebviewUrl::App("desktop/permission-target.html".into()))
            .title("PeekaView: App-Liste in den Systemeinstellungen")
            .transparent(true)
            .decorations(false)
            .shadow(false)
            .resizable(false)
            .always_on_top(true)
            .skip_taskbar(true)
            .visible_on_all_workspaces(true)
            .focused(false)
            .focusable(false)
            .disable_drag_drop_handler()
            .visible(false)
            .build();
        let target = match target.and_then(|target| {
            if let Err(error) = target.set_ignore_cursor_events(true) {
                let _ = target.destroy();
                return Err(error);
            }
            Ok(target)
        }) {
            Ok(target) => target,
            Err(error) => {
                crate::log(&format!("permissions: could not mark System Settings: {error}"));
                let _ = window.destroy();
                return;
            }
        };
        let helper_style = window.clone();
        let target_style = target.clone();
        let _ = app.run_on_main_thread(move || {
            follow_system_appearance(&helper_style);
            follow_system_appearance(&target_style);
        });
        let cleanup = target.clone();
        window.on_window_event(move |event| {
            if matches!(event, tauri::WindowEvent::Destroyed) {
                let _ = cleanup.destroy();
            }
        });
        let app = app.clone();
        std::thread::spawn(move || {
            let mut settings = settings::Session::new();
            let mut step: Option<&'static str> = None;
            let mut shown = false;
            let mut focused_step = false;
            let mut marked = None;
            loop {
                let miss = missing();
                if app.get_webview_window(HELPER).is_none() {
                    return; // closed
                }
                let Some(&next) = miss.first() else { break };
                if step != Some(next) {
                    if !open_pane(next) {
                        crate::log("permissions: could not open System Settings");
                        let _ = window.destroy();
                        return;
                    }
                    step = Some(next);
                    focused_step = false;
                }
                // stick to the System Settings window, wherever it is moved
                let settings_rect = settings.follow();
                if marked != settings_rect {
                    if let Some(rect) = settings_rect {
                        // Reserve 64 px below Settings for the badge (see .perm-target-frame).
                        let _ = target.set_size(tauri::LogicalSize::new(rect.w + 8, rect.h + 72));
                        let _ = target.set_position(tauri::LogicalPosition::new(rect.x - 4, rect.y - 4));
                        let _ = target.show();
                    } else {
                        let _ = target.hide();
                    }
                    marked = settings_rect;
                }
                if !shown || (settings_rect.is_some() && !focused_step) {
                    let _ = window.show();
                    let _ = window.set_focus();
                    shown = true;
                    focused_step = settings_rect.is_some();
                }
                let s = status();
                let _ = app.emit_to(HELPER, "perm", serde_json::json!({ "step": next, "screen": s.screen, "accessibility": s.accessibility, "targetVisible": settings_rect.is_some(), "accessibilityRequired": s.accessibility_required }));
                // Capture the managed handle, not a raw NSWindow pointer that could outlive it.
                let front = window.clone();
                let marker = target.clone();
                let _ = app.run_on_main_thread(move || {
                    follow_system_appearance(&front);
                    follow_system_appearance(&marker);
                    if let Some(rect) = settings_rect {
                        if let (Some(work), Ok(size), Ok(scale)) = (settings::work_area(rect), front.outer_size(), front.scale_factor()) {
                            let size = size.to_logical::<f64>(scale);
                            let position = helper_position(rect, work, (size.width.ceil() as i32, size.height.ceil() as i32));
                            let _ = front.set_position(tauri::LogicalPosition::new(position.0, position.1));
                        }
                    }
                    if settings_rect.is_some() {
                        if let Ok(ns) = marker.ns_window() {
                            unsafe { crate::macos::keep_in_front(ns) };
                        }
                    }
                    if let Ok(ns) = front.ns_window() {
                        unsafe { crate::macos::keep_in_front(ns) };
                    }
                });
                std::thread::sleep(std::time::Duration::from_millis(350));
            }
            let _ = target.destroy();
            // Close before announcing success: the UI may restart PeekaView for screen access.
            settings.close_owned();
            // all granted: the helper shows its success state, then goes; the PeekaView window cheers
            // (and restarts the app, so screen recording takes effect)
            let s = status();
            let _ = app.emit_to(HELPER, "perm", serde_json::json!({ "step": "done", "screen": s.screen, "accessibility": s.accessibility, "accessibilityRequired": s.accessibility_required }));
            if needs_restart {
                // The main webview stays hidden during startup; it must not own this restart.
                std::thread::sleep(std::time::Duration::from_millis(900));
                let handle = app.clone();
                let _ = app.run_on_main_thread(move || {
                    crate::session::shutdown(&handle, false);
                    handle.restart();
                });
            } else {
                for label in ["main", "toolbar"] {
                    let _ = app.emit_to(label, "permission-granted", "accessibility");
                }
                std::thread::sleep(std::time::Duration::from_millis(900));
                let _ = window.destroy();
            }
        });
    }
    #[cfg(not(target_os = "macos"))]
    let _ = (app, kind);
}

pub fn open_settings(kind: &str) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    if !open_pane(kind_of(kind)) { return Err("Systemeinstellungen konnten nicht geöffnet werden. Bitte erneut versuchen.".into()); }
    #[cfg(not(target_os = "macos"))]
    let _ = kind;
    Ok(())
}

/// Opens the System Settings pane of a permission (and puts PeekaView into its list where macOS
/// allows that).
#[cfg(target_os = "macos")]
fn open_pane(kind: &str) -> bool {
    // no CGRequestScreenCaptureAccess: its system prompt would get in the way – the helper's
    // drag tile puts the app into the list instead
    let pane = if kind == "accessibility" { "Privacy_Accessibility" } else { "Privacy_ScreenCapture" };
    std::process::Command::new("open").arg(format!("x-apple.systempreferences:com.apple.preference.security?{pane}")).status().is_ok_and(|s| s.success())
}

#[cfg(target_os = "macos")]
fn helper_position(settings: crate::guard::Rect, monitor: crate::guard::Rect, size: (i32, i32)) -> (i32, i32) {
    let right = settings.x + settings.w + 10;
    let x = if right + size.0 <= monitor.x + monitor.w { right } else { settings.x - size.0 - 10 };
    (x.clamp(monitor.x, (monitor.x + monitor.w - size.0).max(monitor.x)),
     settings.y.clamp(monitor.y, (monitor.y + monitor.h - size.1).max(monitor.y)))
}

#[cfg(target_os = "macos")]
mod settings;

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::*;
    use crate::guard::Rect;

    #[test]
    fn startup_requires_every_required_permission() {
        assert!(!required_granted(false, false, false));
        assert!(!required_granted(false, true, false));
        assert!(required_granted(true, false, false)); // viewing does not require control
        assert!(!required_granted(true, false, true));
        assert!(required_granted(true, true, true));
    }

    #[test]
    fn helper_follows_on_either_side_and_stays_on_the_display() {
        let monitor = Rect { x: -1440, y: 0, w: 1440, h: 900 };
        let mut settings = Rect { x: -1300, y: 100, w: 700, h: 700 };
        assert_eq!(helper_position(settings, monitor, (300, 430)), (-590, 100));
        settings.x = -800;
        assert_eq!(helper_position(settings, monitor, (300, 430)), (-1110, 100));
        settings.y = 750;
        assert_eq!(helper_position(settings, monitor, (300, 430)), (-1110, 470));
        settings.w = 1400;
        settings.x = -1440;
        assert_eq!(helper_position(settings, monitor, (300, 430)), (-1440, 470));
    }
}

/// Starts a native file drag of the app bundle, e.g. into the System Settings list.
pub fn drag_app(app: &AppHandle, kind: &str) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let window = app.get_webview_window("permission").ok_or("no helper window")?;
        let path = app_path().ok_or("app not found")?;
        let kind = kind_of(kind);
        let events = app.clone();
        let (tx, rx) = std::sync::mpsc::channel();
        app.run_on_main_thread(move || {
            let image = drag::Image::Raw(include_bytes!("../icons/128x128.png").to_vec());
            let options = drag::Options { skip_animatation_on_cancel_or_failure: false, mode: drag::DragMode::Copy };
            let _ = tx.send(drag::start_drag(&window, drag::DragItem::Files(vec![path]), image, move |result, _| {
                let _ = events.emit_to(HELPER, "perm-drag", serde_json::json!({ "kind": kind, "dropped": matches!(result, drag::DragResult::Dropped) }));
            }, options).map_err(|e| e.to_string()));
        })
        .map_err(|e| e.to_string())?;
        rx.recv().map_err(|e| e.to_string())?
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, kind);
        Ok(())
    }
}
