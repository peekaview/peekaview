//! Tray / menu bar icon: a click opens the PeekaView window to pick what to share – or, while
//! sharing, brings up the toolbar; its menu has the running share's controls, the switches, the
//! permanent rooms, the last viewer connections and the settings.

use serde_json::json;
use tauri::{
    menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, Wry,
};

use crate::session::Mode;

const ID: &str = "peekaview";

const MODES: [(Mode, &str); 3] = [(Mode::View, "Nur zusehen"), (Mode::Draw, "Zeigen & malen"), (Mode::Control, "Steuern")];

/// The tray icon's click: the running share's toolbar, otherwise the PeekaView window.
fn open(app: &AppHandle) {
    match app.get_webview_window("toolbar") {
        Some(toolbar) => {
            let _ = toolbar.show();
            let _ = toolbar.set_focus();
        }
        None => crate::show_main(app),
    }
}

fn menu(app: &AppHandle) -> tauri::Result<Menu<Wry>> {
    let settings = crate::settings::get(app);
    let rooms = crate::rooms::all(app);
    let links: Vec<MenuItem<Wry>> = rooms
        .iter()
        .map(|r| {
            let label = format!("{}{}{}", r.name, if r.pin.is_some() { " · PIN" } else { "" }, if r.remote { " · Remote" } else { "" });
            MenuItem::with_id(app, format!("copy:{}", r.id), label, true, None::<&str>)
        })
        .collect::<tauri::Result<_>>()?;
    let none = MenuItem::with_id(app, "rooms-none", "Noch keine dauerhaften Raumlinks", false, None::<&str>)?;
    let mut link_refs: Vec<&dyn tauri::menu::IsMenuItem<Wry>> = links.iter().map(|l| l as &dyn tauri::menu::IsMenuItem<Wry>).collect();
    if link_refs.is_empty() {
        link_refs.push(&none);
    }
    let copy = Submenu::with_items(app, "Raumlink kopieren", true, &link_refs)?;
    // rooms watched in PeekaView (links from the viewer website)
    let recent: Vec<MenuItem<Wry>> = crate::viewers::recent(app)
        .iter()
        .enumerate()
        .map(|(i, r)| MenuItem::with_id(app, format!("join:{i}"), r.label(), true, None::<&str>))
        .collect::<tauri::Result<_>>()?;
    let no_recent = MenuItem::with_id(app, "recent-none", "Noch keine", false, None::<&str>)?;
    let mut recent_refs: Vec<&dyn tauri::menu::IsMenuItem<Wry>> = recent.iter().map(|l| l as &dyn tauri::menu::IsMenuItem<Wry>).collect();
    if recent_refs.is_empty() {
        recent_refs.push(&no_recent);
    }
    let recent = Submenu::with_items(app, "Letzte Verbindungen", true, &recent_refs)?;
    let live = crate::session::live(app);
    let mut items: Vec<Box<dyn tauri::menu::IsMenuItem<Wry>>> = Vec::new();
    match &live {
        Some((_, mode)) => {
            items.push(Box::new(MenuItem::with_id(app, "open", "Freigabe läuft …", true, None::<&str>)?));
            items.push(Box::new(MenuItem::with_id(app, "copy_live", "Link kopieren", true, None::<&str>)?));
            let modes: Vec<CheckMenuItem<Wry>> = MODES
                .iter()
                .map(|(m, label)| CheckMenuItem::with_id(app, format!("mode:{}", m.as_str()), *label, true, m == mode, None::<&str>))
                .collect::<tauri::Result<_>>()?;
            let refs: Vec<&dyn tauri::menu::IsMenuItem<Wry>> = modes.iter().map(|m| m as &dyn tauri::menu::IsMenuItem<Wry>).collect();
            items.push(Box::new(Submenu::with_items(app, "Zuschauer dürfen", true, &refs)?));
            items.push(Box::new(MenuItem::with_id(app, "stop", "Freigabe beenden", true, None::<&str>)?));
        }
        None => items.push(Box::new(MenuItem::with_id(app, "open", "Teilen …", true, None::<&str>)?)),
    }
    items.push(Box::new(recent));
    items.push(Box::new(PredefinedMenuItem::separator(app)?));
    items.push(Box::new(CheckMenuItem::with_id(app, "keep_link", "Raumlink beibehalten", true, settings["keep_link"] == true, None::<&str>)?));
    items.push(Box::new(CheckMenuItem::with_id(app, "allow_resize", "Resize/Anordnen erlauben", true, settings["allow_resize"] == true, None::<&str>)?));
    items.push(Box::new(PredefinedMenuItem::separator(app)?));
    items.push(Box::new(copy));
    items.push(Box::new(MenuItem::with_id(app, "rooms", "Einstellungen & Räume …", true, None::<&str>)?));
    items.push(Box::new(PredefinedMenuItem::separator(app)?));
    items.push(Box::new(MenuItem::with_id(app, "quit", "PeekaView beenden", true, None::<&str>)?));
    let refs: Vec<&dyn tauri::menu::IsMenuItem<Wry>> = items.iter().map(|i| i.as_ref()).collect();
    Menu::with_items(app, &refs)
}

/// Rebuilds the menu (settings or rooms changed).
pub fn refresh(app: &AppHandle) {
    if let (Some(tray), Ok(menu)) = (app.tray_by_id(ID), menu(app)) {
        let _ = tray.set_menu(Some(menu));
    }
}

pub fn create(app: &AppHandle) -> tauri::Result<()> {
    let mut builder = TrayIconBuilder::with_id(ID).tooltip("PeekaView").menu(&menu(app)?).show_menu_on_left_click(false);
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder
        .on_menu_event(|app, event| {
            let id = event.id().as_ref().to_string();
            match id.as_str() {
                "open" => open(app),
                "copy_live" => {
                    if let Some((link, _)) = crate::session::live(app) {
                        if crate::clip::os::write(Some(link), None, None, &[]).is_ok() {
                            let _ = app.emit_to("toolbar", "copied", ());
                        }
                    }
                }
                "stop" => crate::session::stop(app, None, true),
                "keep_link" | "allow_resize" => {
                    let on = crate::settings::get(app)[&id] != true;
                    let settings = crate::settings::set(app, &json!({ id.clone(): on }));
                    let _ = app.emit("settings", settings);
                    crate::session::settings_changed(app);
                    refresh(app);
                }
                "rooms" => crate::open_rooms_window(app),
                "quit" => {
                    crate::session::shutdown(app, true);
                    app.exit(0);
                }
                other if other.starts_with("join:") => {
                    let recent = other[5..].parse::<usize>().ok().and_then(|i| crate::viewers::recent(app).get(i).cloned());
                    if let Some(r) = recent {
                        let app = app.clone();
                        tauri::async_runtime::spawn(async move { crate::viewers::open(&app, &r.room, r.name, r.who) });
                    }
                }
                other if other.starts_with("mode:") => {
                    if let Some(mode) = Mode::parse(&other[5..]) {
                        crate::session::set_mode(app, mode);
                    }
                }
                other => {
                    if let Some(room) = other.strip_prefix("copy:").and_then(|id| crate::rooms::get(app, id)) {
                        let site = crate::nsite::resolve(app, &crate::settings::text(app, "site").unwrap_or_default());
                        let link = room.view(&site)["link"].as_str().unwrap_or_default().to_string();
                        if crate::clip::os::write(Some(link), None, None, &[]).is_ok() {
                            let to = if crate::session::live(app).is_some() { "toolbar" } else { "main" };
                            let _ = app.emit_to(to, "toast", format!("Link von „{}“ kopiert", room.name));
                        }
                    }
                }
            }
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                open(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(())
}
