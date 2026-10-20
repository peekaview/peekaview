#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod capture;
mod clip;
mod control;
mod guard;
mod focus;
mod invite;
mod p2p;
#[cfg(target_os = "macos")]
mod macos;
mod permissions;
mod recording;
mod resume;
#[cfg(target_os = "macos")]
mod speech;
mod input;
mod session;
mod sources;
mod video;

use tauri::{AppHandle, Manager, WindowEvent};
use tauri_plugin_deep_link::DeepLinkExt;

pub const OVERLAY_TITLE: &str = "PeekaView Overlay";

/// Appends a line to the diagnostic log (<tmp>/peekaview.log).
pub fn log(line: &str) {
    use std::io::Write;
    let stamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0);
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(std::env::temp_dir().join("peekaview.log")) {
        let _ = writeln!(f, "{stamp} {line}");
    }
}

#[tauri::command]
async fn list_sources() -> Vec<sources::SourceInfo> {
    sources::list()
}

/// Red frame around the source picked in the UI (before sharing starts). `None` hides it.
#[tauri::command]
async fn highlight(app: AppHandle, source: Option<String>) {
    session::highlight(&app, source.as_deref());
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
async fn start_share(
    app: AppHandle,
    site: String,
    name: String,
    source: String,
    room: Option<String>,
    color: Option<String>,
    relays: Option<Vec<String>>,
    ice: Option<serde_json::Value>,
    turn_urls: Option<Vec<String>>,
    turn_secret: Option<String>,
    signing_key: Option<String>,
) -> Result<serde_json::Value, String> {
    let room = room.filter(|r| !r.trim().is_empty());
    let clean = |l: Option<Vec<String>>| l.unwrap_or_default().into_iter().map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).collect();
    let opts = session::StartOptions {
        site,
        name,
        source,
        room,
        color,
        relays: clean(relays),
        ice,
        turn_urls: clean(turn_urls),
        turn_secret: turn_secret.filter(|s| !s.is_empty()),
        signing_key: signing_key.filter(|k| !k.is_empty()),
        admitted: vec![],
    };
    session::start(app, opts).await
}

#[tauri::command]
fn permission_status() -> permissions::Status {
    permissions::status()
}

/// `kind`: "screen" or "accessibility"
#[tauri::command]
async fn request_permission(app: AppHandle, kind: String) {
    permissions::request(&app, &kind);
}

#[tauri::command]
async fn drag_app(app: AppHandle) -> Result<(), String> {
    permissions::drag_app(&app)
}

/// Where the toolbar sits. Until the user drags it, it is centered at the top edge; afterwards the
/// bar's left edge stays where it was put (physical pixels), also while the panel folds out.
struct Toolbar {
    /// left edge of the bar and top edge, set by dragging
    anchor: Option<(i32, i32)>,
    /// offset of the bar inside the window (logical px): the panel below may be wider
    bar_left: f64,
    /// the grip was grabbed: moves come from the user until the next resize (our own resizes
    /// move the window too – Cocoa keeps the bottom-left corner)
    dragging: bool,
}

static TOOLBAR: std::sync::Mutex<Toolbar> = std::sync::Mutex::new(Toolbar { anchor: None, bar_left: 0.0, dragging: false });

/// The main window is the toolbar; the UI reports the size it needs (bar only, or bar + picker /
/// settings panel) and where the bar starts inside it.
#[tauri::command]
fn toolbar_resize(window: tauri::WebviewWindow, width: f64, height: f64, bar_left: Option<f64>) -> Result<(), String> {
    let mut toolbar = TOOLBAR.lock().unwrap();
    toolbar.dragging = false;
    toolbar.bar_left = bar_left.unwrap_or(0.0);
    let monitors = window.available_monitors().unwrap_or_default();
    let monitor = toolbar
        .anchor
        .and_then(|(ax, ay)| {
            monitors.into_iter().find(|m| {
                let (p, s) = (m.position(), m.size());
                ax >= p.x && ay >= p.y && ax < p.x + s.width as i32 && ay < p.y + s.height as i32
            })
        })
        .or_else(|| window.current_monitor().ok().flatten())
        .or_else(|| window.primary_monitor().ok().flatten())
        .ok_or("kein Bildschirm")?;
    let area = monitor.work_area();
    let scale = monitor.scale_factor();
    let (w, h) = ((width * scale) as i32, (height * scale) as i32);
    let (ax, ay, aw, ah) = (area.position.x, area.position.y, area.size.width as i32, area.size.height as i32);
    let (x, y) = match toolbar.anchor {
        None => (ax + (aw - w) / 2, ay + (4.0 * scale) as i32),
        Some((left, top)) => (left - (toolbar.bar_left * scale) as i32, top),
    };
    // keep it on the screen (a panel folding out near the bottom pushes it up for a while)
    let x = x.min(ax + aw - w).max(ax);
    let y = y.min(ay + ah - h).max(ay);
    drop(toolbar);
    // size before position (Cocoa keeps the bottom-left corner when resizing)
    window.set_size(tauri::LogicalSize::new(width, height)).map_err(|e| e.to_string())?;
    window.set_position(tauri::PhysicalPosition::new(x, y)).map_err(|e| e.to_string())?;
    window.show().map_err(|e| e.to_string())
}

/// Grip of a frameless panel (e.g. the clipboard): move its window with the mouse.
#[tauri::command]
fn drag_window(window: tauri::WebviewWindow) -> Result<(), String> {
    window.start_dragging().map_err(|e| e.to_string())
}

// ------------------------------------------------------------------ shared clipboard

/// Join requests: let a viewer in or turn them away (`peer` missing = everybody waiting).
#[tauri::command]
fn admit(app: AppHandle, peer: Option<String>, allow: bool) {
    session::admit(&app, peer, allow);
}

#[tauri::command]
fn peers() -> serde_json::Value {
    session::peers()
}

#[tauri::command]
fn clip_list(app: AppHandle) -> Vec<clip::Meta> {
    session::clip_list(&app)
}

#[tauri::command]
async fn clip_add_paths(app: AppHandle, paths: Vec<String>) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || session::clip_add_paths(&app, &paths)).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn clip_from_os(app: AppHandle) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || session::clip_from_os(&app)).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn clip_read(app: AppHandle, id: String) -> Result<tauri::ipc::Response, String> {
    session::clip_read(&app, &id).map(tauri::ipc::Response::new)
}

#[tauri::command]
fn clip_set_preview(app: AppHandle, id: String, preview: String) {
    session::clip_set_preview(&app, &id, &preview);
}

#[tauri::command]
async fn clip_copy(app: AppHandle, id: String) -> Result<(), String> {
    session::clip_copy(&app, &id)
}

#[tauri::command]
async fn clip_save(app: AppHandle, id: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || session::clip_save(&app, &id)).await.map_err(|e| e.to_string())?
}

#[tauri::command]
fn clip_remove(app: AppHandle, id: String) {
    session::clip_remove(&app, &id);
}

#[tauri::command]
fn clip_window(app: AppHandle, open: Option<bool>) -> Result<bool, String> {
    session::clip_window(&app, open)
}

/// Shows a saved file in Finder / Explorer.
#[tauri::command]
fn reveal(path: String) {
    let path = std::path::Path::new(&path);
    open_path(path.parent().unwrap_or(path));
}

/// The toolbar's grip: move the frameless window with the mouse.
#[tauri::command]
fn toolbar_drag(window: tauri::WebviewWindow) -> Result<(), String> {
    TOOLBAR.lock().unwrap().dragging = true;
    window.start_dragging().map_err(|e| e.to_string())
}

/// The main window moved: remember the bar's new place if the user is dragging it.
fn toolbar_moved(window: &tauri::Window, pos: tauri::PhysicalPosition<i32>) {
    let mut toolbar = TOOLBAR.lock().unwrap();
    if toolbar.dragging {
        let scale = window.scale_factor().unwrap_or(1.0);
        toolbar.anchor = Some((pos.x + (toolbar.bar_left * scale) as i32, pos.y));
    }
}

#[tauri::command]
fn quit(app: AppHandle) {
    session::shutdown(&app, true);
    app.exit(0);
}

#[tauri::command]
fn dismiss_permission(app: AppHandle, kind: String) {
    permissions::dismiss(&app, &kind);
}

#[tauri::command]
fn restart_app(app: AppHandle) {
    // keep the saved state: the share continues after the restart
    session::shutdown(&app, false);
    app.restart();
}

/// Continues a share interrupted by a restart; `null` when there is nothing to continue.
#[tauri::command]
async fn resume(app: AppHandle) -> Result<Option<serde_json::Value>, String> {
    session::continue_after_restart(app).await
}

/// Where an OPENAI_API_KEY was found (the key itself never goes to the UI).
#[tauri::command]
fn env_key_status() -> Option<String> {
    recording::env_key().map(|(_, at)| at)
}

#[tauri::command]
async fn start_recording(
    app: AppHandle,
    local: bool,
    key: Option<String>,
    use_env: bool,
    title: String,
    started_label: String,
    file_stamp: String,
) -> Result<String, String> {
    #[cfg(target_os = "macos")]
    let apple = local && speech::authorize() && speech::available();
    #[cfg(not(target_os = "macos"))]
    let apple = { let _ = local; false };
    let key = if use_env { recording::env_key().map(|(k, _)| k) } else { key.filter(|k| !k.trim().is_empty()) };
    let engine = match (apple, key) {
        #[cfg(target_os = "macos")]
        (true, _) => recording::Engine::Apple,
        (_, Some(key)) => recording::Engine::OpenAi(key),
        _ => recording::Engine::None,
    };
    let file_stamp: String = file_stamp.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_').collect();
    let opts = recording::Options { title, started_label, file_stamp, engine };
    session::start_recording(&app, opts).map(str::to_string)
}

/// Raw 16 kHz mono PCM (i16 LE) from the toolbar's audio mix.
#[tauri::command]
fn recording_audio(app: AppHandle, request: tauri::ipc::Request) {
    if let tauri::ipc::InvokeBody::Raw(bytes) = request.body() {
        session::recording_audio(&app, bytes);
    }
}

#[tauri::command]
async fn stop_recording(app: AppHandle) -> Result<String, String> {
    let path = tauri::async_runtime::spawn_blocking(move || session::stop_recording(&app)).await.map_err(|e| e.to_string())??;
    open_path(&path);
    Ok(path.display().to_string())
}

/// Opens a file with the default app (the report in the browser).
pub fn open_path(path: &std::path::Path) {
    #[cfg(target_os = "macos")]
    let _ = std::process::Command::new("open").arg(path).spawn();
    #[cfg(target_os = "windows")]
    let _ = std::process::Command::new("cmd").args(["/C", "start", ""]).arg(path).spawn();
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let _ = std::process::Command::new("xdg-open").arg(path).spawn();
}

/// Invitation received via deep link before the UI was ready.
#[tauri::command]
fn take_invite(app: AppHandle) -> Option<serde_json::Value> {
    app.state::<invite::PendingInvite>().0.lock().unwrap().take()
}

#[tauri::command]
fn signal(app: AppHandle, msg: serde_json::Value) {
    session::signal(&app, msg);
}

#[tauri::command]
fn set_mode(app: AppHandle, mode: String) -> Result<(), String> {
    session::set_mode(&app, session::Mode::parse(&mode).ok_or("Unbekannter Modus")?);
    Ok(())
}

/// Shares another screen or window in the running session.
#[tauri::command]
async fn switch_source(app: AppHandle, source: String) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || session::switch_source(&app, &source)).await.map_err(|e| e.to_string())?
}

#[tauri::command]
fn stop_share(app: AppHandle) {
    session::stop(&app, None, true);
}

fn main() {
    tauri::Builder::default()
        // a second launch (e.g. by a deep link on Windows/Linux) hands its URL to the running app
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(main) = app.get_webview_window("main") {
                let _ = main.set_focus();
            }
        }))
        .plugin(tauri_plugin_deep_link::init())
        .manage(session::SessionState::default())
        .manage(invite::PendingInvite::default())
        .setup(|app| {
            // keep the toolbar out of screen captures (macOS: the capture filter excludes our windows)
            #[cfg(not(target_os = "macos"))]
            if let Some(main) = app.get_webview_window("main") {
                let _ = main.set_content_protected(true);
            }
            #[cfg(any(target_os = "windows", target_os = "linux"))]
            let _ = app.deep_link().register_all();
            let handle = app.handle().clone();
            app.deep_link().on_open_url(move |event| {
                for url in event.urls() {
                    invite::handle(&handle, &url);
                }
            });
            // development only: PEEKAVIEW_DEV_SHARE=screen:<id> [PEEKAVIEW_DEV_ROOM=<secret>] starts a share
            #[cfg(debug_assertions)]
            if let Ok(source) = std::env::var("PEEKAVIEW_DEV_SHARE") {
                let handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    let opts = session::StartOptions {
                        site: "http://localhost:8090".into(),
                        name: "Dev".into(),
                        source,
                        room: std::env::var("PEEKAVIEW_DEV_ROOM").ok(),
                        color: None,
                        relays: vec![],
                        ice: None,
                        turn_urls: vec![],
                        turn_secret: None,
                        signing_key: std::env::var("PEEKAVIEW_DEV_KEY").ok(),
                        admitted: vec![],
                    };
                    let result = session::start(handle.clone(), opts).await;
                    crate::log(&format!("dev share: {result:?}"));
                    if let Ok(mode) = std::env::var("PEEKAVIEW_DEV_MODE") {
                        if let Some(mode) = session::Mode::parse(&mode) {
                            session::set_mode(&handle, mode);
                        }
                    }
                    // PEEKAVIEW_DEV_ADMIT=<seconds>: lets every waiting viewer in after that delay
                    if let Some(delay) = std::env::var("PEEKAVIEW_DEV_ADMIT").ok().and_then(|d| d.parse::<u64>().ok()) {
                        loop {
                            tokio::time::sleep(std::time::Duration::from_secs(delay)).await;
                            session::admit(&handle, None, true);
                        }
                    }
                });
            }
            if let Ok(Some(urls)) = app.deep_link().get_current() {
                for url in urls {
                    invite::handle(app.handle(), &url);
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![list_sources,
            highlight,
            start_share,
            take_invite,
            set_mode,
            signal,
            stop_share,
            switch_source,
            permission_status,
            request_permission,
            drag_app,
            dismiss_permission,
            toolbar_resize,
            toolbar_drag,
            drag_window,
            peers,
            admit,
            clip_list,
            clip_add_paths,
            clip_from_os,
            clip_read,
            clip_set_preview,
            clip_copy,
            clip_save,
            clip_remove,
            clip_window,
            reveal,
            quit,
            restart_app,
            resume,
            env_key_status,
            start_recording,
            recording_audio,
            stop_recording])
        .on_window_event(|window, event| {
            if let (WindowEvent::Moved(pos), "main") = (event, window.label()) {
                toolbar_moved(window, *pos);
                return;
            }
            let WindowEvent::CloseRequested { api, .. } = event else { return };
            match window.label() {
                "main" => {
                    session::shutdown(window.app_handle(), true);
                    window.app_handle().exit(0);
                }
                "permission" if !permissions::may_close() => api.prevent_close(),
                _ => {}
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building PeekaView")
        .run(|app, event| {
            // quit by the OS (e.g. "Beenden & erneut öffnen" after granting a permission):
            // keep the saved state so the share continues on the next launch
            if let tauri::RunEvent::Exit = event {
                session::shutdown(app, false);
            }
        });
}
