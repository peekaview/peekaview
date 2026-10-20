//! Tray / menu bar icon: a click shows or hides the toolbar; its menu has the switches that
//! matter without the toolbar and the permanent rooms.

use serde_json::json;
use tauri::{
    menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, Wry,
};

const ID: &str = "peekaview";

/// Shows / hides the toolbar.
pub fn toggle_toolbar(app: &AppHandle) {
    if let Some(main) = app.get_webview_window("main") {
        if main.is_visible().unwrap_or(false) {
            let _ = main.hide();
        } else {
            let _ = main.show();
            let _ = main.set_focus();
        }
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
    Menu::with_items(
        app,
        &[
            &MenuItem::with_id(app, "toggle", "Toolbar ein-/ausblenden", true, None::<&str>)?,
            &PredefinedMenuItem::separator(app)?,
            &CheckMenuItem::with_id(app, "keep_link", "Raumlink beibehalten", true, settings["keep_link"] == true, None::<&str>)?,
            &CheckMenuItem::with_id(app, "allow_resize", "Resize/Anordnen erlauben", true, settings["allow_resize"] == true, None::<&str>)?,
            &PredefinedMenuItem::separator(app)?,
            &copy,
            &MenuItem::with_id(app, "rooms", "Raumlinks & Remote-Zugriff …", true, None::<&str>)?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "quit", "PeekaView beenden", true, None::<&str>)?,
        ],
    )
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
                "toggle" => toggle_toolbar(app),
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
                other => {
                    if let Some(room) = other.strip_prefix("copy:").and_then(|id| crate::rooms::get(app, id)) {
                        let site = crate::nsite::resolve(app, &crate::settings::text(app, "site").unwrap_or_default());
                        let link = room.view(&site)["link"].as_str().unwrap_or_default().to_string();
                        if crate::clip::os::write(Some(link), None, None, &[]).is_ok() {
                            let _ = app.emit_to("main", "toast", format!("Link von „{}“ kopiert", room.name));
                        }
                    }
                }
            }
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                toggle_toolbar(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(())
}
