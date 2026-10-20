//! macOS privacy permissions: screen recording (always needed) and accessibility (remote control).
//!
//! When one is missing we open the matching System Settings pane and dock a small helper window
//! next to it, from which the app can be dragged into the list.

use std::sync::Mutex;

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
        pub fn CGRequestScreenCaptureAccess() -> bool;
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

/// Kind of permission the helper window currently asks for.
static HELPER_KIND: Mutex<Option<&'static str>> = Mutex::new(None);
const HELPER: &str = "permission";

fn kind_of(kind: &str) -> &'static str {
    if kind == "accessibility" { "accessibility" } else { "screen" }
}

pub fn granted(kind: &str) -> bool {
    let s = status();
    if kind_of(kind) == "accessibility" { s.accessibility } else { s.screen }
}

/// The helper may only be closed once its permission is granted.
pub fn may_close() -> bool {
    HELPER_KIND.lock().unwrap().is_none_or(granted)
}

/// Removes the helper for `kind`, e.g. when remote control is switched off again.
pub fn dismiss(app: &AppHandle, kind: &str) {
    let mut current = HELPER_KIND.lock().unwrap();
    if *current == Some(kind_of(kind)) {
        *current = None;
        if let Some(window) = app.get_webview_window(HELPER) {
            let _ = window.destroy();
        }
    }
}

/// Opens System Settings at the right pane and shows the helper window beside it. The helper
/// stays in front of everything until the permission is granted.
pub fn request(app: &AppHandle, kind: &str) {
    #[cfg(target_os = "macos")]
    {
        let kind = kind_of(kind);
        let pane = if kind == "accessibility" { "Privacy_Accessibility" } else { "Privacy_ScreenCapture" };
        if kind == "screen" {
            // registers the app in the list (switched off) and shows the system prompt once
            unsafe { sys::CGRequestScreenCaptureAccess() };
        }
        let _ = std::process::Command::new("open")
            .arg(format!("x-apple.systempreferences:com.apple.preference.security?{pane}"))
            .status();

        {
            let mut current = HELPER_KIND.lock().unwrap();
            if let Some(existing) = app.get_webview_window(HELPER) {
                if *current == Some(kind) {
                    let _ = existing.show();
                    return;
                }
                let _ = existing.destroy();
            }
            *current = Some(kind);
        }
        let url = WebviewUrl::App(format!("desktop/permission.html?kind={kind}").into());
        let Ok(window) = WebviewWindowBuilder::new(app, HELPER, url)
            .title("PeekaView – Berechtigung")
            .inner_size(340.0, 560.0)
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
            // dock next to System Settings once it is on screen
            for _ in 0..20 {
                std::thread::sleep(std::time::Duration::from_millis(150));
                if let Some((x, y, w)) = settings_window() {
                    let right_edge = xcap::Monitor::from_point(x, y)
                        .ok()
                        .and_then(|m| Some(m.x().ok()? + m.width().ok()? as i32))
                        .unwrap_or(1440);
                    let left = if x + w + 352 <= right_edge { x + w + 12 } else { x - 352 };
                    let _ = window.set_position(tauri::LogicalPosition::new(left, y));
                    break;
                }
            }
            let _ = window.show();
            // stay above System Settings (and everything else) until the permission is granted
            while !granted(kind) && HELPER_KIND.lock().unwrap().is_some_and(|k| k == kind) {
                let Ok(ns) = window.ns_window() else { return };
                let ns = ns as usize;
                let _ = app.run_on_main_thread(move || unsafe { crate::macos::keep_in_front(ns as *mut std::ffi::c_void) });
                std::thread::sleep(std::time::Duration::from_millis(700));
            }
            if !granted(kind) {
                return; // dismissed or replaced
            }
            // granted: the helper shows its success state, then disappears; the toolbar cheers
            let _ = app.emit_to("main", "permission-granted", kind);
            std::thread::sleep(std::time::Duration::from_secs(2));
            let mut current = HELPER_KIND.lock().unwrap();
            if *current == Some(kind) {
                *current = None;
                let _ = window.destroy();
            }
        });
    }
    #[cfg(not(target_os = "macos"))]
    let _ = (app, kind);
}

#[cfg(target_os = "macos")]
fn settings_window() -> Option<(i32, i32, i32)> {
    xcap::Window::all().ok()?.into_iter().find_map(|w| {
        let app = crate::sources::clean_name(&w.app_name().ok()?);
        if !matches!(app.as_str(), "Systemeinstellungen" | "System Settings") {
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
