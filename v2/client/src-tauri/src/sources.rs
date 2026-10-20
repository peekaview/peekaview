//! Shareable screens and windows, with thumbnails for the picker.

use std::thread;

use base64::{engine::general_purpose::STANDARD, Engine};
use serde::Serialize;
use xcap::image::{codecs::jpeg::JpegEncoder, imageops, DynamicImage, RgbaImage};

const THUMB_W: f64 = 480.0;
const THUMB_H: f64 = 300.0;

/// System processes whose windows are never offered for sharing (English and German names).
const SYSTEM_APPS: &[&str] = &[
    "Dock", "Window Server", "SystemUIServer", "Control Center", "Kontrollzentrum", "Notification Center",
    "Mitteilungszentrale", "NotificationCenter", "Spotlight", "WindowManager", "loginwindow",
    "UserNotificationCenter", "universalAccessAuthWarn", "CoreServicesUIAgent", "Wallpaper", "TextInputMenuAgent",
];

#[derive(Serialize)]
pub struct SourceInfo {
    id: String,
    kind: &'static str,
    title: String,
    app: String,
    thumb: Option<String>,
}

enum Item {
    Screen(xcap::Monitor),
    Window(xcap::Window),
}

// SAFETY: see `video::Source` – xcap's HMONITOR / HWND are process-wide identifiers.
#[cfg(target_os = "windows")]
unsafe impl Send for Item {}

/// App names from macOS may contain invisible characters (soft hyphen, direction marks).
pub fn clean_name(name: &str) -> String {
    name.chars().filter(|c| !matches!(c, '\u{ad}' | '\u{200b}'..='\u{200f}' | '\u{2060}' | '\u{feff}')).collect()
}

fn thumbnail(image: RgbaImage) -> Option<String> {
    let (w, h) = image.dimensions();
    let s = (THUMB_W / w as f64).min(THUMB_H / h as f64).min(1.0);
    let small = imageops::thumbnail(&image, ((w as f64 * s) as u32).max(1), ((h as f64 * s) as u32).max(1));
    let mut jpeg = Vec::new();
    JpegEncoder::new_with_quality(&mut jpeg, 72).encode_image(&DynamicImage::ImageRgba8(small).to_rgb8()).ok()?;
    Some(format!("data:image/jpeg;base64,{}", STANDARD.encode(jpeg)))
}

pub fn list() -> Vec<SourceInfo> {
    let me = std::process::id();
    let mut items: Vec<(SourceInfo, Item)> = Vec::new();

    for (i, m) in xcap::Monitor::all().unwrap_or_default().into_iter().enumerate() {
        let Ok(id) = m.id() else { continue };
        let name = m.friendly_name().or_else(|_| m.name()).unwrap_or_default();
        let info = SourceInfo { id: format!("screen:{id}"), kind: "screen", title: format!("Bildschirm {}", i + 1), app: name, thumb: None };
        items.push((info, Item::Screen(m)));
    }
    let normal = crate::guard::normal_window_ids();
    for w in xcap::Window::all().unwrap_or_default() {
        let (Ok(id), Ok(title)) = (w.id(), w.title()) else { continue };
        let app = clean_name(&w.app_name().unwrap_or_default());
        let usable = w.pid().ok() != Some(me)
            && normal.as_ref().is_none_or(|ids| ids.contains(&id))
            && !SYSTEM_APPS.contains(&app.as_str())
            && !title.trim().is_empty()
            && !w.is_minimized().unwrap_or(true)
            && w.width().unwrap_or(0) >= 120
            && w.height().unwrap_or(0) >= 80;
        if usable {
            items.push((SourceInfo { id: format!("window:{id}"), kind: "window", title, app, thumb: None }, Item::Window(w)));
        }
    }

    // capturing is the slow part: do it in parallel
    let threads = thread::available_parallelism().map(|n| n.get()).unwrap_or(4).min(8);
    let chunk = items.len().div_ceil(threads).max(1);
    thread::scope(|s| {
        for part in items.chunks_mut(chunk) {
            s.spawn(move || {
                for (info, item) in part {
                    let image = match item {
                        Item::Screen(m) => m.capture_image(),
                        Item::Window(w) => w.capture_image(),
                    };
                    info.thumb = image.ok().and_then(thumbnail);
                }
            });
        }
    });
    items.into_iter().map(|(info, _)| info).collect()
}

#[cfg(test)]
mod tests {
    /// Lists which apps the picker offers on this desktop (app names only).
    #[test]
    #[ignore]
    fn live_sources() {
        let list = super::list();
        let mut apps: Vec<String> = list.iter().filter(|s| s.kind == "window").map(|s| s.app.clone()).collect();
        apps.sort();
        println!("screens: {:?}", list.iter().filter(|s| s.kind == "screen").map(|s| (&s.id, &s.app)).collect::<Vec<_>>());
        println!("window apps: {apps:?}");
        println!("thumbs: {}/{}", list.iter().filter(|s| s.thumb.is_some()).count(), list.len());
    }
}
