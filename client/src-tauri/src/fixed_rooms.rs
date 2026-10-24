//! Shared rooms use the optional self-hosted PHP service; media remains on the existing P2P path.
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::{HashMap, HashSet},
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
    time::Duration,
};
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

#[derive(Clone, Serialize, Deserialize)]
pub struct Config {
    api: String,
    token: String,
}
fn trusted(window: &tauri::WebviewWindow) -> bool {
    window.label() == "main"
        || window.label() == "fixed-rooms"
        || window.label().starts_with("fixed-call-")
}
static CONFIG: Mutex<Option<Config>> = Mutex::new(None);
static ACCESS_LOCK: Mutex<()> = Mutex::new(());
static AUTOMATIC: Mutex<Option<(String, String)>> = Mutex::new(None);
static AUTO_STARTING: AtomicBool = AtomicBool::new(false);

#[derive(Clone, Default, Serialize, Deserialize)]
struct Access {
    enabled: bool,
    screens: Vec<crate::rooms::Screen>,
    apps: Vec<crate::rooms::App>,
}
#[derive(Deserialize)]
pub struct Selection {
    enabled: bool,
    screens: Vec<String>,
    apps: Vec<String>,
}
fn access_file(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    Ok(config_path(app)?.with_file_name("fixed-access.json"))
}
fn access(app: &AppHandle) -> Result<HashMap<String, Access>, String> {
    let path = access_file(app)?;
    if !path.exists() {
        return Ok(HashMap::new());
    }
    serde_json::from_slice(&std::fs::read(path).map_err(|e| e.to_string())?)
        .map_err(|e| format!("Zugriffsauswahl konnte nicht gelesen werden: {e}"))
}
fn screens() -> Result<Vec<crate::rooms::Screen>, String> {
    xcap::Monitor::all()
        .map_err(|e| e.to_string())?
        .iter()
        .enumerate()
        .map(|(i, m)| {
            Ok(crate::rooms::Screen {
                id: format!("screen:{}", m.id().map_err(|e| e.to_string())?),
                name: format!(
                    "Bildschirm {} · {}",
                    i + 1,
                    m.friendly_name()
                        .or_else(|_| m.name())
                        .map_err(|e| e.to_string())?
                ),
            })
        })
        .collect()
}
#[tauri::command]
pub async fn fixed_access_options(
    app: AppHandle,
    window: tauri::WebviewWindow,
    room: String,
) -> Result<Value, String> {
    if !trusted(&window) {
        return Err("Diese Ansicht darf keine Zugriffsauswahl öffnen.".into());
    }
    tauri::async_runtime::spawn_blocking(move||{
        let selection=access(&app)?.remove(&room).unwrap_or_default();
        Ok(json!({"screens":screens()?,"apps":crate::rooms::installed().iter().map(|a|json!({"id":a["path"],"name":a["name"]})).collect::<Vec<_>>(),"selection":{"screens":selection.screens.iter().map(|s|&s.id).collect::<Vec<_>>(),"apps":selection.apps.iter().map(|a|&a.path).collect::<Vec<_>>()}}))
    }).await.map_err(|e|e.to_string())?
}
#[tauri::command]
pub async fn fixed_access_configure(
    app: AppHandle,
    window: tauri::WebviewWindow,
    room: String,
    selection: Selection,
) -> Result<(), String> {
    if !trusted(&window) {
        return Err("Diese Ansicht darf keinen Zugriff einrichten.".into());
    }
    if room.len() != 16 || !room.bytes().all(|c| c.is_ascii_hexdigit()) {
        return Err("Ungültige Gruppe.".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let _lock = ACCESS_LOCK.lock().unwrap();
        let mut policies = access(&app)?;
        let mut policy = policies.remove(&room).unwrap_or_default();
        policy.enabled = selection.enabled;
        if selection.enabled {
            if !crate::permissions::ready() || !crate::permissions::granted("accessibility") {
                return Err(
                    "Erlaube zuerst Bildschirmaufnahme und Bedienungshilfen in PeekaView.".into(),
                );
            }
            let available = screens()?;
            if selection
                .screens
                .iter()
                .any(|id| !available.iter().any(|s| &s.id == id))
            {
                return Err("Ein ausgewählter Bildschirm ist nicht mehr vorhanden.".into());
            }
            policy.screens = available
                .into_iter()
                .filter(|s| selection.screens.contains(&s.id))
                .collect();
            let installed = crate::rooms::installed();
            if selection
                .apps
                .iter()
                .any(|path| !installed.iter().any(|a| a["path"].as_str() == Some(path)))
            {
                return Err("Eine ausgewählte Anwendung ist nicht mehr installiert.".into());
            }
            policy.apps = installed
                .iter()
                .filter(|a| selection.apps.iter().any(|p| a["path"].as_str() == Some(p)))
                .map(|a| crate::rooms::App {
                    id: crate::clip::new_id(),
                    name: a["name"].as_str().unwrap_or("").into(),
                    path: a["path"].as_str().unwrap_or("").into(),
                })
                .collect();
            if policy.screens.is_empty() && policy.apps.is_empty() {
                return Err("Wähle mindestens einen Bildschirm oder eine Anwendung.".into());
            }
            request("rooms/access", Some(json!({"room":room,"unattended":true})))?;
        }
        policies.insert(room.clone(), policy);
        crate::resume::write_json(
            &access_file(&app)?,
            &serde_json::to_value(policies).map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;
        if !selection.enabled {
            request(
                "rooms/access",
                Some(json!({"room":room,"unattended":false})),
            )?;
        }
        let active = AUTOMATIC
            .lock()
            .unwrap()
            .clone()
            .filter(|(r, _)| r == &room);
        if let Some((_, call)) = active {
            stop_share(&app, &call);
            request("calls/leave", Some(json!({"call":call})))?;
        }
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}
fn remote_room(policy: Access, id: &str, name: &str) -> crate::rooms::Room {
    crate::rooms::Room {
        id: id.into(),
        name: name.into(),
        secret: crate::p2p::signal::new_room_secret(),
        key: crate::p2p::signal::new_signing_key()
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect(),
        pin: None,
        remote: true,
        apps: policy.apps,
        desktop: false,
        screens: policy.screens,
    }
}
pub fn remote_for_resume(
    app: &AppHandle,
    room: &str,
    call: &str,
) -> Result<crate::rooms::Room, String> {
    let policy = access(app)?
        .remove(room)
        .filter(|a| a.enabled)
        .ok_or("Unbeaufsichtigter Zugriff ist auf diesem Gerät nicht aktiviert.")?;
    let state = request("state", None)?;
    let c = state["calls"]
        .as_array()
        .and_then(|cs| {
            cs.iter().find(|c| {
                c["id"] == call
                    && c["room"] == room
                    && c["status"] == "joined"
                    && c["unattended_allowed"] == true
            })
        })
        .ok_or("Der unbeaufsichtigte Anruf ist nicht mehr autorisiert.")?;
    Ok(remote_room(
        policy,
        room,
        c["name"].as_str().unwrap_or("Gruppe"),
    ))
}
pub fn target_allowed(app: &AppHandle, room: &str, call: &str, target: &str) -> Result<(), String> {
    let remote = remote_for_resume(app, room, call)?;
    if !remote.screens.iter().any(|s| s.id == target) && !remote.apps.iter().any(|a| a.id == target)
    {
        return Err("Dieses Ziel ist nicht für unbeaufsichtigten Zugriff freigegeben.".into());
    }
    Ok(())
}
async fn start_automatic(app: AppHandle, call: Value) -> Result<(), String> {
    if crate::session::running(&app).is_ok() {
        return Err("Es läuft bereits eine Freigabe.".into());
    }
    if !crate::permissions::ready() || !crate::permissions::granted("accessibility") {
        return Err("Die Berechtigungen für unbeaufsichtigten Zugriff fehlen.".into());
    }
    let id = call["id"].as_str().ok_or("Ungültiger Anruf")?.to_string();
    let room = call["room"].as_str().ok_or("Ungültige Gruppe")?.to_string();
    let policy = access(&app)?
        .remove(&room)
        .filter(|a| a.enabled)
        .ok_or("Auf diesem Gerät ist kein Zugriff freigegeben.")?;
    let join = id.clone();
    tauri::async_runtime::spawn_blocking(move || {
        request("calls/auto-join", Some(json!({"call":join})))
    })
    .await
    .map_err(|e| e.to_string())??;
    let remote = remote_room(policy, &room, call["name"].as_str().unwrap_or("Gruppe"));
    let opts = crate::session::StartOptions {
        site: crate::settings::VIEWER_SITE.into(),
        name: crate::settings::text(&app, "name").unwrap_or_else(|| "Host".into()),
        sources: vec![],
        room: Some(remote.secret.clone()),
        signing_key: Some(remote.key.clone()),
        color: None,
        relays: crate::settings::lines(&app, "relays"),
        ice: None,
        turn_urls: crate::settings::lines(&app, "turn_urls"),
        turn_secret: crate::settings::text(&app, "turn_secret"),
        admitted: vec![],
        remote: Some(remote),
        fixed_call: Some(id.clone()),
    };
    if let Err(e) = crate::session::start(app.clone(), opts).await {
        let leave = id.clone();
        let _ = tauri::async_runtime::spawn_blocking(move || {
            request("calls/leave", Some(json!({"call":leave})))
        })
        .await;
        return Err(e);
    }
    crate::session::set_mode(&app, crate::session::Mode::Control);
    Ok(())
}
pub fn mark_automatic(room: &str, call: &str) {
    *AUTOMATIC.lock().unwrap() = Some((room.into(), call.into()));
}

fn config_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("fixed-rooms.json"))
}
fn validate(config: &Config) -> Result<(), String> {
    let url = tauri::Url::parse(&config.api).map_err(|e| e.to_string())?;
    if url.scheme() != "https"
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
        || config.token.len() != 43
    {
        return Err(
            "Ungültige Raumdienst-Konfiguration: HTTPS und ein bestätigtes Gerät erforderlich."
                .into(),
        );
    }
    Ok(())
}
pub fn request(action: &str, body: Option<Value>) -> Result<Value, String> {
    let c = CONFIG
        .lock()
        .unwrap()
        .clone()
        .ok_or("Bitte den Raumdienst zuerst verbinden.")?;
    request_config(&c, action, body).map_err(|(_, message)| message)
}
fn request_config(c: &Config, action: &str, body: Option<Value>) -> Result<Value, (bool, String)> {
    let read = || -> Result<(u16, Value), String> {
        let mut url = tauri::Url::parse(&c.api).map_err(|e| e.to_string())?;
        url.query_pairs_mut().append_pair("action", action);
        let agent: ureq::Agent = ureq::Agent::config_builder()
            .timeout_global(Some(Duration::from_secs(12)))
            .max_redirects(0)
            .http_status_as_error(false)
            .build()
            .into();
        let auth = format!("Bearer {}", c.token);
        let mut response = if let Some(body) = body {
            agent
                .post(url.as_str())
                .header("Authorization", &auth)
                .header("Content-Type", "application/json")
                .send(body.to_string().as_bytes())
        } else {
            agent
                .get(url.as_str())
                .header("Authorization", &auth)
                .call()
        }
        .map_err(|e| e.to_string())?;
        let status = response.status().as_u16();
        let text = response
            .body_mut()
            .with_config()
            .limit(1_000_000)
            .read_to_string()
            .map_err(|e| e.to_string())?;
        let value: Value = serde_json::from_str(&text)
            .map_err(|_| "Der Raumdienst hat kein gültiges JSON gesendet.")?;
        Ok((status, value))
    };
    let (status, value) = read().map_err(|message| (false, message))?;
    if !(200..300).contains(&status) {
        return Err((
            status == 401,
            value["error"]
                .as_str()
                .unwrap_or("Raumdienst-Anfrage fehlgeschlagen.")
                .into(),
        ));
    }
    Ok(value)
}
fn clear_session(app: &AppHandle, expected: Option<&Config>) -> Result<(), String> {
    let mut current = CONFIG.lock().unwrap();
    if expected.is_some_and(|old| {
        current
            .as_ref()
            .is_none_or(|c| c.api != old.api || c.token != old.token)
    }) {
        return Ok(());
    }
    let cleanup = || -> Result<(), String> {
        for path in [config_path(app)?, access_file(app)?] {
            if let Err(e) = std::fs::remove_file(path) {
                if e.kind() != std::io::ErrorKind::NotFound {
                    return Err(e.to_string());
                }
            }
        }
        Ok(())
    };
    let result = cleanup();
    let connected = current.take().is_some();
    drop(current);
    if let Ok(shared) = crate::session::running(app) {
        if let Some(call) = &shared.fixed_call {
            stop_share(app, call);
        }
    }
    if connected {
        let _ = app.emit("fixed-session-ended", ());
    }
    result
}
#[tauri::command]
pub fn fixed_room_configure(
    app: AppHandle,
    window: tauri::WebviewWindow,
    session: String,
) -> Result<(), String> {
    if !trusted(&window) {
        return Err("Diese Ansicht darf den Raumdienst nicht ändern.".into());
    }
    let config: Option<Config> = serde_json::from_str(&session).map_err(|e| e.to_string())?;
    let Some(config) = config else {
        return clear_session(&app, None);
    };
    validate(&config)?;
    let mut current = CONFIG.lock().unwrap();
    let path = config_path(&app)?;
    let mut file = std::fs::OpenOptions::new();
    file.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        file.mode(0o600);
    }
    use std::io::Write;
    file.open(path)
        .and_then(|mut f| f.write_all(serde_json::to_string(&config).unwrap().as_bytes()))
        .map_err(|e| e.to_string())?;
    *current = Some(config);
    Ok(())
}
#[tauri::command]
pub fn fixed_room_window(app: AppHandle, call: String) -> Result<(), String> {
    open(&app, &call, "")
}
fn open(app: &AppHandle, call: &str, fragment: &str) -> Result<(), String> {
    if !call.is_empty() && (call.len() != 16 || !call.bytes().all(|c| c.is_ascii_hexdigit())) {
        return Err("Ungültiger Anruf.".into());
    }
    let label = if call.is_empty() {
        "fixed-rooms".into()
    } else {
        format!("fixed-call-{call}")
    };
    let hash = if fragment.is_empty() {
        format!("call={call}")
    } else {
        fragment.to_string()
    };
    let script = format!("location.hash={};", serde_json::to_string(&hash).unwrap());
    if let Some(w) = app.get_webview_window(&label) {
        if !fragment.is_empty() {
            w.eval(&script).map_err(|e| e.to_string())?;
        }
        w.show().map_err(|e| e.to_string())?;
        return w.set_focus().map_err(|e| e.to_string());
    }
    crate::set_dock(app, true);
    let window = WebviewWindowBuilder::new(app, label, WebviewUrl::App("fixed-rooms.html".into()))
        .title("Kontakte – PeekaView")
        .inner_size(1100., 760.)
        .min_inner_size(520., 420.)
        .background_throttling(tauri::utils::config::BackgroundThrottlingPolicy::Disabled)
        .initialization_script(&script)
        .build()
        .map_err(|e| e.to_string())?;
    if !call.is_empty() {
        let app = app.clone();
        let id = call.to_string();
        window.on_window_event(move |e| {
            if matches!(e, tauri::WindowEvent::Destroyed) {
                if crate::resume::permission_flow(&app).is_some() {
                    return;
                }
                stop_share(&app, &id);
                let id = id.clone();
                std::thread::spawn(move || {
                    let _ = request("calls/leave", Some(json!({"call":id})));
                });
            }
        });
    }
    Ok(())
}
pub fn handle(app: &AppHandle, url: &tauri::Url) -> bool {
    if url.scheme() != "peekaview" || url.host_str() != Some("rooms") {
        return false;
    }
    // The deep-link plugin holds its event lock here; creating a webview re-enters it.
    let app = app.clone();
    let fragment = url.fragment().unwrap_or("").to_string();
    tauri::async_runtime::spawn(async move {
        if let Err(e) = open(&app, "", &fragment) {
            crate::log(&e)
        }
    });
    true
}
#[tauri::command]
pub async fn fixed_share_picker(
    app: AppHandle,
    window: tauri::WebviewWindow,
    call: String,
) -> Result<(), String> {
    if !trusted(&window) {
        return Err("Diese Ansicht darf keine Freigabe starten.".into());
    }
    if call.len() != 16 || !call.bytes().all(|c| c.is_ascii_hexdigit()) {
        return Err("Ungültiger Anruf.".into());
    }
    let id = call.clone();
    let state = tauri::async_runtime::spawn_blocking(move || request("state", None))
        .await
        .map_err(|e| e.to_string())??;
    let c = state["calls"]
        .as_array()
        .and_then(|calls| {
            calls
                .iter()
                .find(|c| c["id"] == id && c["status"] == "joined")
        })
        .ok_or("Bitte dem Raum zuerst beitreten.")?;
    crate::show_main(&app);
    app.emit_to("main", "fixed-share", json!({"id":call,"name":c["name"]}))
        .map_err(|e| e.to_string())
}
pub fn admitted(call: &str) -> Result<Vec<String>, String> {
    let state = request("state", None)?;
    let c = state["calls"]
        .as_array()
        .and_then(|calls| {
            calls
                .iter()
                .find(|c| c["id"] == call && c["status"] == "joined")
        })
        .ok_or("Bitte dem Raum zuerst beitreten.")?;
    Ok(c["participants"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|p| p["id"].as_str().map(str::to_string))
        .collect())
}
pub fn conversation(call: &str) -> Result<crate::recording::Conversation, String> {
    let state = request("state", None)?;
    let c = state["calls"]
        .as_array()
        .and_then(|calls| {
            calls
                .iter()
                .find(|c| c["id"] == call && c["status"] == "joined")
        })
        .ok_or("Der Anruf ist nicht mehr aktiv.")?;
    Ok(crate::recording::Conversation {
        id: c["room"].as_str().ok_or("Die Raumzuordnung fehlt.")?.into(),
        kind: c["kind"].as_str().ok_or("Die Gesprächsart fehlt.")?.into(),
        name: c["name"].as_str().ok_or("Der Gesprächsname fehlt.")?.into(),
    })
}
pub fn publish(call: &str, stream: Option<&str>, previous: Option<&str>) -> Result<(), String> {
    request(
        "calls/stream",
        Some(json!({"call":call,"stream":stream,"previous":previous})),
    )
    .map(|_| ())
}
fn stop_share(app: &AppHandle, call: &str) {
    let mut automatic = AUTOMATIC.lock().unwrap();
    if automatic.as_ref().is_some_and(|(_, id)| id == call) {
        *automatic = None;
    }
    drop(automatic);
    let _ = app.emit_to("main", "fixed-call-ended", call);
    let matches = crate::session::running(app).is_ok_and(|s| s.fixed_call.as_deref() == Some(call));
    if matches {
        crate::session::stop(app, None, true)
    }
}
#[tauri::command]
pub fn fixed_stop_share(app: AppHandle, window: tauri::WebviewWindow, call: String) {
    if trusted(&window) {
        stop_share(&app, &call)
    }
}
#[tauri::command]
pub fn fixed_recording_enabled(app: AppHandle, window: tauri::WebviewWindow, call: String) -> bool {
    if window.label() != format!("fixed-call-{call}") {
        return false;
    }
    crate::session::running(&app)
        .is_ok_and(|s| s.fixed_call.as_deref() == Some(&call) && s.recorder().is_some())
}
#[tauri::command]
pub fn fixed_recording_audio(
    app: AppHandle,
    window: tauri::WebviewWindow,
    request: tauri::ipc::Request,
) {
    let call = request
        .headers()
        .get("x-peekaview-call")
        .and_then(|v| v.to_str().ok());
    if call.is_none_or(|id| window.label() != format!("fixed-call-{id}")) {
        return;
    }
    if let Ok(shared) = crate::session::running(&app) {
        if call.is_some() && shared.fixed_call.as_deref() == call {
            if let (Some(recorder), tauri::ipc::InvokeBody::Raw(bytes)) =
                (shared.recorder(), request.body())
            {
                recorder.audio(bytes)
            }
        }
    }
}
pub fn start(app: &AppHandle) {
    if let Ok(path) = config_path(app) {
        if let Ok(data) = std::fs::read(path) {
            if let Ok(c) = serde_json::from_slice::<Config>(&data) {
                if validate(&c).is_ok() {
                    *CONFIG.lock().unwrap() = Some(c)
                }
            }
        }
    }
    let app = app.clone();
    std::thread::spawn(move || {
        let mut notified = HashSet::new();
        let mut failed = false;
        loop {
            let config = CONFIG.lock().unwrap().clone();
            if let Some(config) = config {
                let observed = crate::session::running(&app).ok();
                match request_config(&config, "state", None) {
                    Ok(state) => {
                        failed = false;
                        if let Some(calls) = state["calls"].as_array() {
                            for c in calls {
                                let Some(id) = c["id"].as_str() else { continue };
                                let new_request = c["requests"]
                                    .as_array()
                                    .into_iter()
                                    .flatten()
                                    .filter(|person| {
                                        person["id"].as_str().is_some_and(|device| {
                                            notified.insert(format!("request:{id}:{device}"))
                                        })
                                    })
                                    .count()
                                    > 0;
                                if new_request {
                                    let (app, id) = (app.clone(), id.to_string());
                                    let handle = app.clone();
                                    let _ = app.run_on_main_thread(move || {
                                        if let Err(e) = open(&handle, &id, "") {
                                            crate::log(&e)
                                        }
                                    });
                                }
                                if c["status"] == "ringing" && notified.insert(id.to_string()) {
                                    let enabled = access(&app)
                                        .ok()
                                        .and_then(|mut a| a.remove(c["room"].as_str()?))
                                        .is_some_and(|a| a.enabled);
                                    if c["unattended_allowed"] == true && enabled {
                                        if AUTO_STARTING
                                            .compare_exchange(
                                                false,
                                                true,
                                                Ordering::SeqCst,
                                                Ordering::SeqCst,
                                            )
                                            .is_ok()
                                        {
                                            let app = app.clone();
                                            let call = c.clone();
                                            tauri::async_runtime::spawn(async move {
                                                if let Err(e) = start_automatic(app, call).await {
                                                    crate::log(&format!(
                                                        "Unbeaufsichtigter Zugriff: {e}"
                                                    ));
                                                }
                                                AUTO_STARTING.store(false, Ordering::SeqCst);
                                            });
                                        }
                                        continue;
                                    }
                                    let app = app.clone();
                                    let id = id.to_string();
                                    let handle = app.clone();
                                    let _ = app.run_on_main_thread(move || {
                                        if let Err(e) = open(&handle, &id, "") {
                                            crate::log(&e)
                                        }
                                    });
                                }
                                if c["status"] == "joined" {
                                    if app
                                        .get_webview_window(&format!("fixed-call-{id}"))
                                        .is_some()
                                        || crate::session::running(&app)
                                            .is_ok_and(|s| s.fixed_call.as_deref() == Some(id))
                                    {
                                        let _ =
                                            request("calls/heartbeat", Some(json!({"call":id})));
                                    }
                                    for p in c["participants"].as_array().into_iter().flatten() {
                                        if let Some(peer) = p["id"].as_str() {
                                            let matches = crate::session::running(&app)
                                                .is_ok_and(|s| s.fixed_call.as_deref() == Some(id));
                                            if matches {
                                                crate::session::admit(&app, Some(peer.into()), true)
                                            }
                                        }
                                    }
                                }
                            }
                        }
                        let automatic = AUTOMATIC.lock().unwrap().clone().filter(|(_, id)| {
                            observed
                                .as_ref()
                                .is_some_and(|s| s.fixed_call.as_deref() == Some(id))
                        });
                        if let Some((room, id)) = automatic {
                            let allowed = state["calls"].as_array().is_some_and(|cs| {
                                cs.iter()
                                    .any(|c| c["id"] == id && c["unattended_allowed"] == true)
                            });
                            let enabled = access(&app)
                                .ok()
                                .and_then(|mut a| a.remove(&room))
                                .is_some_and(|a| a.enabled);
                            let sharing = crate::session::running(&app)
                                .is_ok_and(|s| s.fixed_call.as_deref() == Some(&id));
                            if !allowed || !enabled || !sharing {
                                stop_share(&app, &id);
                                if let Err(e) = request("calls/leave", Some(json!({"call":id}))) {
                                    crate::log(&e);
                                }
                            }
                        }
                        let active = observed
                            .filter(|s| {
                                crate::session::running(&app)
                                    .is_ok_and(|current| std::sync::Arc::ptr_eq(s, &current))
                            })
                            .and_then(|s| s.fixed_call.clone());
                        if let Some(id) = active {
                            if !state["calls"].as_array().is_some_and(|calls| {
                                calls
                                    .iter()
                                    .any(|c| c["id"] == id && c["status"] == "joined")
                            }) {
                                stop_share(&app, &id)
                            }
                        }
                    }
                    Err((unauthorized, e)) => {
                        if unauthorized {
                            if let Err(error) = clear_session(&app, Some(&config)) {
                                crate::log(&error);
                            }
                            notified.clear();
                        }
                        if !failed {
                            crate::log(&format!("fixed rooms: {e}"));
                            failed = true;
                        }
                    }
                }
            }
            std::thread::sleep(Duration::from_secs(6));
        }
    });
}
