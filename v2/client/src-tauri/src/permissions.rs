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
        Status { screen: sys::CGPreflightScreenCaptureAccess(), accessibility: sys::AXIsProcessTrusted() }
    }
    #[cfg(not(target_os = "macos"))]
    Status { screen: true, accessibility: true }
}

/// The installed app bundle (or the bare binary in development).
#[cfg(target_os = "macos")]
fn app_path() -> Option<std::path::PathBuf> {
    let exe = std::env::current_exe().ok()?;
    Some(exe.ancestors().find(|p| p.extension().is_some_and(|e| e == "app")).map(|p| p.to_path_buf()).unwrap_or(exe))
}

const HELPER: &str = "permission";
#[cfg(target_os = "macos")]
const HELPER_SIZE: (f64, f64) = (300.0, 400.0);

fn kind_of(kind: &str) -> &'static str {
    if kind == "accessibility" { "accessibility" } else { "screen" }
}

pub fn granted(kind: &str) -> bool {
    let s = status();
    if kind_of(kind) == "accessibility" { s.accessibility } else { s.screen }
}

/// Missing permissions in the order they are asked for: accessibility first (works right away),
/// screen recording last (macOS applies it only after a restart of the app).
#[cfg(target_os = "macos")]
fn missing() -> Vec<&'static str> {
    let s = status();
    let mut list = Vec::new();
    if !s.accessibility {
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

/// Everything PeekaView needs, in one go: one helper window, docked to System Settings (it
/// follows the window), opens the pane of each missing permission in turn and goes once all are
/// granted. `_kind` is kept for the callers – whatever is missing is asked for.
pub fn request(app: &AppHandle, _kind: &str) {
    #[cfg(target_os = "macos")]
    {
        if missing().is_empty() {
            return;
        }
        if let Some(existing) = app.get_webview_window(HELPER) {
            let _ = existing.show();
            return;
        }
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
        let app = app.clone();
        std::thread::spawn(move || {
            let mut step: Option<&'static str> = None;
            let mut docked: Option<(i32, i32)> = None;
            let mut shown = false;
            loop {
                let miss = missing();
                if app.get_webview_window(HELPER).is_none() {
                    return; // closed
                }
                let Some(&next) = miss.first() else { break };
                if step != Some(next) {
                    open_pane(next);
                    step = Some(next);
                    docked = None;
                }
                let s = status();
                let _ = app.emit_to(HELPER, "perm", serde_json::json!({ "step": next, "screen": s.screen, "accessibility": s.accessibility }));
                // stick to the System Settings window, wherever it is moved
                if let Some((x, y, w)) = settings_window() {
                    let right_edge = xcap::Monitor::from_point(x, y)
                        .ok()
                        .and_then(|m| Some(m.x().ok()? + m.width().ok()? as i32))
                        .unwrap_or(1440);
                    let width = HELPER_SIZE.0 as i32;
                    let left = if x + w + width + 10 <= right_edge { x + w + 10 } else { x - width - 10 };
                    if docked != Some((left, y)) {
                        let _ = window.set_position(tauri::LogicalPosition::new(left, y));
                        docked = Some((left, y));
                    }
                }
                if !shown {
                    let _ = window.show();
                    shown = true;
                }
                if let Ok(ns) = window.ns_window() {
                    let ns = ns as usize;
                    let _ = app.run_on_main_thread(move || unsafe { crate::macos::keep_in_front(ns as *mut std::ffi::c_void) });
                }
                std::thread::sleep(std::time::Duration::from_millis(350));
            }
            // all granted: the helper shows its success state, then goes; the toolbar cheers
            // (and restarts the app, so screen recording takes effect)
            let _ = app.emit_to(HELPER, "perm", serde_json::json!({ "step": "done", "screen": true, "accessibility": true }));
            let _ = app.emit_to("main", "permission-granted", if step == Some("screen") { "screen" } else { "accessibility" });
            std::thread::sleep(std::time::Duration::from_secs(2));
            let _ = window.destroy();
        });
    }
    #[cfg(not(target_os = "macos"))]
    let _ = app;
}

/// Opens the System Settings pane of a permission (and puts PeekaView into its list where macOS
/// allows that).
#[cfg(target_os = "macos")]
fn open_pane(kind: &str) {
    // no CGRequestScreenCaptureAccess: its system prompt would get in the way – the helper's
    // drag tile puts the app into the list instead
    let pane = if kind == "accessibility" { "Privacy_Accessibility" } else { "Privacy_ScreenCapture" };
    let _ = std::process::Command::new("open").arg(format!("x-apple.systempreferences:com.apple.preference.security?{pane}")).status();
}

#[cfg(target_os = "macos")]
fn settings_window() -> Option<(i32, i32, i32)> {
    xcap::Window::all().ok()?.into_iter().find_map(|w| {
        let app = crate::sources::clean_name(&w.app_name().ok()?);
        if !matches!(app.as_str(), "Systemeinstellungen" | "System Settings") {
            return None;
        }
        if w.is_minimized().unwrap_or(false) {
            return None;
        }
        let width = w.width().ok()? as i32;
        (width > 300).then_some(())?;
        Some((w.x().ok()?, w.y().ok()?, width))
    })
}

/// Starts a native file drag of the app bundle, e.g. into the System Settings list.
pub fn drag_app(app: &AppHandle) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let window = app.get_webview_window("permission").ok_or("no helper window")?;
        let path = app_path().ok_or("app not found")?;
        let (tx, rx) = std::sync::mpsc::channel();
        app.run_on_main_thread(move || {
            let image = drag::Image::Raw(include_bytes!("../icons/128x128.png").to_vec());
            let options = drag::Options { skip_animatation_on_cancel_or_failure: false, mode: drag::DragMode::Copy };
            let _ = tx.send(drag::start_drag(&window, drag::DragItem::Files(vec![path]), image, |_, _| {}, options).map_err(|e| e.to_string()));
        })
        .map_err(|e| e.to_string())?;
        rx.recv().map_err(|e| e.to_string())?
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        Ok(())
    }
}
