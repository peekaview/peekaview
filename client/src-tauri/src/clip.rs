//! Shared clipboard of a session: files, images and text that participants drop or paste into
//! the clipboard panel. The presenter keeps them in a temp folder until the share ends; viewers
//! upload to and download from it over a separate data channel.
//!
//! Also the presenter's side of remote copy & paste ([`os`]): the OS clipboard is written / read
//! natively and the platform's own paste / copy shortcut is pressed – no typing emulation, so
//! nothing is swallowed, keyboard layouts don't matter and formatting, images and files survive.

use std::{
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::Mutex,
};

use base64::Engine;
use serde::Serialize;
use serde_json::Value;

/// Largest item.
pub const MAX_SIZE: u64 = 100 * 1024 * 1024;
/// Everything together; the oldest items make room.
const MAX_TOTAL: u64 = 1024 * 1024 * 1024;
const MAX_ITEMS: usize = 60;
const MAX_PREVIEW: usize = 48 * 1024;
const SNIPPET: usize = 600;

#[derive(Clone, Serialize, Debug)]
pub struct Meta {
    pub id: String,
    pub name: String,
    pub mime: String,
    pub size: u64,
    /// participant id (0 = presenter)
    pub from: u32,
    /// unix ms
    pub at: u64,
    /// small JPEG/PNG data URL (images, PDFs)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub preview: Option<String>,
    /// beginning of a text item
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    /// bytes arrived so far (< size while uploading)
    pub received: u64,
    /// transfer only (remote copy & paste), not listed in the panel
    #[serde(skip)]
    pub hidden: bool,
}

impl Meta {
    /// Item description sent by a participant (`{t:'put', id, name, mime, size, preview?, text?, hidden?}`).
    pub fn from_json(v: &Value, from: u32) -> Result<Meta, String> {
        let id = v["id"].as_str().filter(|id| valid_id(id)).ok_or("ungültige Id")?.to_string();
        let size = v["size"].as_u64().ok_or("Größe fehlt")?;
        if size > MAX_SIZE {
            return Err("Datei größer als 100 MB".into());
        }
        let name = clean_name(v["name"].as_str().unwrap_or(""));
        let mime = v["mime"].as_str().filter(|m| m.len() <= 100 && !m.is_empty()).map(str::to_string).unwrap_or_else(|| mime_of(&name).into());
        Ok(Meta {
            id,
            name,
            mime,
            size,
            from,
            at: now_ms(),
            preview: v["preview"].as_str().filter(|p| p.starts_with("data:image/") && p.len() <= MAX_PREVIEW).map(str::to_string),
            text: v["text"].as_str().map(|t| t.chars().take(SNIPPET).collect()),
            received: 0,
            hidden: v["hidden"] == true,
        })
    }
}

fn now_ms() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

pub fn new_id() -> String {
    let mut b = [0u8; 9];
    getrandom::fill(&mut b).expect("os random");
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(b)
}

fn valid_id(id: &str) -> bool {
    (1..=32).contains(&id.len()) && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

/// A file name that is safe on every platform.
fn clean_name(name: &str) -> String {
    let name = name.rsplit(['/', '\\']).next().unwrap_or("");
    let name: String = name
        .chars()
        .filter(|c| !c.is_control() && !matches!(c, '<' | '>' | ':' | '"' | '|' | '?' | '*'))
        .take(120)
        .collect();
    let name = name.trim().trim_start_matches('.').to_string();
    if name.is_empty() {
        "Datei".into()
    } else {
        name
    }
}

pub fn mime_of(name: &str) -> &'static str {
    let ext = name.rsplit_once('.').map(|(_, e)| e.to_ascii_lowercase()).unwrap_or_default();
    match ext.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        "svg" => "image/svg+xml",
        "heic" => "image/heic",
        "pdf" => "application/pdf",
        "txt" | "log" => "text/plain",
        "md" => "text/markdown",
        "csv" => "text/csv",
        "json" => "application/json",
        "html" | "htm" => "text/html",
        "xml" => "text/xml",
        "zip" => "application/zip",
        "doc" | "docx" => "application/msword",
        "xls" | "xlsx" => "application/vnd.ms-excel",
        "ppt" | "pptx" => "application/vnd.ms-powerpoint",
        "mp4" | "m4v" => "video/mp4",
        "mov" => "video/quicktime",
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        _ => "application/octet-stream",
    }
}

fn is_text(mime: &str) -> bool {
    mime.starts_with("text/") || mime == "application/json"
}

/// Small JPEG thumbnail of an image file as data URL.
fn thumbnail(path: &Path, mime: &str) -> Option<String> {
    if !matches!(mime, "image/png" | "image/jpeg" | "image/gif" | "image/webp" | "image/bmp") {
        return None;
    }
    let img = image::ImageReader::open(path).ok()?.with_guessed_format().ok()?.decode().ok()?;
    let thumb = img.thumbnail(320, 240).to_rgb8();
    let mut jpeg = Vec::new();
    image::codecs::jpeg::JpegEncoder::new_with_quality(&mut jpeg, 72).encode_image(&thumb).ok()?;
    let url = format!("data:image/jpeg;base64,{}", base64::engine::general_purpose::STANDARD.encode(jpeg));
    (url.len() <= MAX_PREVIEW).then_some(url)
}

fn snippet(path: &Path) -> Option<String> {
    let mut buf = vec![0u8; 4096];
    let n = fs::File::open(path).ok()?.read(&mut buf).ok()?;
    Some(String::from_utf8_lossy(&buf[..n]).chars().take(SNIPPET).collect())
}

struct Entry {
    meta: Meta,
    path: PathBuf,
    file: Option<fs::File>,
}

pub struct Store {
    dir: PathBuf,
    entries: Mutex<Vec<Entry>>,
    /// wakes the presenter's hub to announce the item list
    pub changed: tokio::sync::Notify,
}

impl Default for Store {
    fn default() -> Self {
        Store {
            dir: std::env::temp_dir().join(format!("peekaview-clip-{}-{}", std::process::id(), new_id())),
            entries: Mutex::default(),
            changed: tokio::sync::Notify::new(),
        }
    }
}

impl Store {
    /// Starts receiving an item; its data follows with [`append`](Self::append).
    pub fn begin(&self, meta: Meta) -> Result<(), String> {
        let mut entries = self.entries.lock().unwrap();
        if entries.iter().any(|e| e.meta.id == meta.id) {
            return Err("Id schon vergeben".into());
        }
        // make room: hidden transfers first, then the oldest items
        loop {
            let total: u64 = entries.iter().map(|e| e.meta.size).sum();
            if entries.len() < MAX_ITEMS && total + meta.size <= MAX_TOTAL {
                break;
            }
            let victim = entries.iter().position(|e| e.meta.hidden && e.file.is_none()).or_else(|| entries.iter().position(|e| e.file.is_none()));
            let Some(i) = victim else { return Err("Zwischenablage ist voll".into()) };
            let old = entries.remove(i);
            let _ = fs::remove_dir_all(old.path.parent().unwrap_or(&old.path));
        }
        let folder = self.dir.join(&meta.id);
        fs::create_dir_all(&folder).map_err(|e| e.to_string())?;
        let path = folder.join(&meta.name);
        let file = fs::File::create(&path).map_err(|e| e.to_string())?;
        let done = meta.size == 0;
        entries.push(Entry { meta, path, file: (!done).then_some(file) });
        drop(entries);
        if done {
            self.complete_preview_last();
        }
        Ok(())
    }

    /// Next chunk of an item; returns the bytes received so far and whether it is complete.
    pub fn append(&self, id: &str, data: &[u8]) -> Result<(u64, bool), String> {
        let mut entries = self.entries.lock().unwrap();
        let entry = entries.iter_mut().find(|e| e.meta.id == id).ok_or("unbekanntes Element")?;
        let file = entry.file.as_mut().ok_or("schon vollständig")?;
        if entry.meta.received + data.len() as u64 > entry.meta.size {
            return Err("mehr Daten als angekündigt".into());
        }
        file.write_all(data).map_err(|e| e.to_string())?;
        entry.meta.received += data.len() as u64;
        let complete = entry.meta.received == entry.meta.size;
        if complete {
            entry.file = None;
        }
        let received = entry.meta.received;
        drop(entries);
        if complete {
            self.finish_preview(id);
        }
        Ok((received, complete))
    }

    /// Previews the presenter can make itself (images, text) once an item is complete.
    fn finish_preview(&self, id: &str) {
        let (path, mime, has_preview, has_text) = {
            let entries = self.entries.lock().unwrap();
            let Some(e) = entries.iter().find(|e| e.meta.id == id) else { return };
            (e.path.clone(), e.meta.mime.clone(), e.meta.preview.is_some(), e.meta.text.is_some())
        };
        let preview = if has_preview { None } else { thumbnail(&path, &mime) };
        let text = if has_text || !is_text(&mime) { None } else { snippet(&path) };
        let mut entries = self.entries.lock().unwrap();
        if let Some(e) = entries.iter_mut().find(|e| e.meta.id == id) {
            e.meta.preview = e.meta.preview.take().or(preview);
            e.meta.text = e.meta.text.take().or(text);
        }
    }

    fn complete_preview_last(&self) {
        let id = self.entries.lock().unwrap().last().map(|e| e.meta.id.clone());
        if let Some(id) = id {
            self.finish_preview(&id);
        }
    }

    /// Drops an unfinished upload (connection gone).
    pub fn abort(&self, id: &str) {
        let mut entries = self.entries.lock().unwrap();
        if let Some(i) = entries.iter().position(|e| e.meta.id == id && e.file.is_some()) {
            let old = entries.remove(i);
            let _ = fs::remove_dir_all(old.path.parent().unwrap_or(&old.path));
        }
    }

    /// Removes an item; `by` must be its sender unless it is the presenter (0).
    pub fn remove(&self, id: &str, by: u32) -> bool {
        let mut entries = self.entries.lock().unwrap();
        let Some(i) = entries.iter().position(|e| e.meta.id == id && (by == 0 || e.meta.from == by)) else { return false };
        let old = entries.remove(i);
        let _ = fs::remove_dir_all(old.path.parent().unwrap_or(&old.path));
        true
    }

    /// Items for the panel (including ones still uploading).
    pub fn list(&self) -> Vec<Meta> {
        self.entries.lock().unwrap().iter().filter(|e| !e.meta.hidden).map(|e| e.meta.clone()).collect()
    }

    /// A complete item and its file.
    pub fn get(&self, id: &str) -> Option<(Meta, PathBuf)> {
        self.entries.lock().unwrap().iter().find(|e| e.meta.id == id && e.file.is_none()).map(|e| (e.meta.clone(), e.path.clone()))
    }

    pub fn set_preview(&self, id: &str, preview: &str) {
        if !preview.starts_with("data:image/") || preview.len() > MAX_PREVIEW {
            return;
        }
        if let Some(e) = self.entries.lock().unwrap().iter_mut().find(|e| e.meta.id == id) {
            e.meta.preview = Some(preview.to_string());
        }
    }

    /// Adds a file of the presenter's disk (copied, so the original may change).
    pub fn add_file(&self, path: &Path, from: u32) -> Result<Meta, String> {
        let size = fs::metadata(path).map_err(|e| e.to_string())?.len();
        if path.is_dir() {
            return Err("Ordner können nicht geteilt werden".into());
        }
        let name = clean_name(&path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default());
        let meta = Meta::from_json(&serde_json::json!({ "id": new_id(), "name": name, "mime": mime_of(&name), "size": size }), from)?;
        let id = meta.id.clone();
        self.begin(meta)?;
        let mut src = fs::File::open(path).map_err(|e| e.to_string())?;
        let mut buf = vec![0u8; 1 << 20];
        loop {
            let n = src.read(&mut buf).map_err(|e| e.to_string())?;
            if n == 0 {
                break;
            }
            if let Err(e) = self.append(&id, &buf[..n]) {
                self.abort(&id);
                return Err(e);
            }
        }
        self.get(&id).map(|(m, _)| m).ok_or_else(|| {
            self.abort(&id);
            "Datei hat sich beim Kopieren geändert".to_string()
        })
    }

    pub fn add_bytes(&self, name: &str, mime: &str, bytes: &[u8], from: u32, hidden: bool) -> Result<Meta, String> {
        let meta = Meta::from_json(&serde_json::json!({ "id": new_id(), "name": name, "mime": mime, "size": bytes.len(), "hidden": hidden }), from)?;
        let id = meta.id.clone();
        self.begin(meta)?;
        if !bytes.is_empty() {
            self.append(&id, bytes)?;
        }
        self.get(&id).map(|(m, _)| m).ok_or_else(|| "Speichern fehlgeschlagen".into())
    }

    /// Deletes everything (share ended).
    pub fn clear(&self) {
        self.entries.lock().unwrap().clear();
        let _ = fs::remove_dir_all(&self.dir);
    }
}

impl Drop for Store {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.dir);
    }
}

/// Copies an item to ~/Downloads under a free name; returns the path.
pub fn save_to_downloads(meta: &Meta, path: &Path) -> Result<PathBuf, String> {
    let home = std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE")).ok_or("kein Benutzerordner")?;
    let dir = PathBuf::from(home).join("Downloads");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let (stem, ext) = match meta.name.rsplit_once('.') {
        Some((s, e)) if !s.is_empty() => (s.to_string(), format!(".{e}")),
        _ => (meta.name.clone(), String::new()),
    };
    let mut target = dir.join(&meta.name);
    let mut n = 2;
    while target.exists() {
        target = dir.join(format!("{stem} ({n}){ext}"));
        n += 1;
    }
    fs::copy(path, &target).map_err(|e| e.to_string())?;
    Ok(target)
}

/// The presenter's OS clipboard.
pub mod os {
    use std::path::{Path, PathBuf};

    use clipboard_rs::{common::RustImage, Clipboard, ClipboardContent, ClipboardContext, ContentFormat, RustImageData};

    /// Counter that changes whenever anything writes to the clipboard.
    pub fn change_count() -> Option<i64> {
        #[cfg(target_os = "macos")]
        return Some(objc2_app_kit::NSPasteboard::generalPasteboard().changeCount() as i64);
        #[cfg(target_os = "windows")]
        return Some(unsafe { windows_sys::Win32::System::DataExchange::GetClipboardSequenceNumber() } as i64);
        #[allow(unreachable_code)]
        None
    }

    fn ctx() -> Result<ClipboardContext, String> {
        ClipboardContext::new().map_err(|e| e.to_string())
    }

    /// Puts content on the clipboard: files, else an image, else text (+ html).
    pub fn write(text: Option<String>, html: Option<String>, image: Option<&Path>, files: &[PathBuf]) -> Result<(), String> {
        let ctx = ctx()?;
        if !files.is_empty() {
            return ctx.set_files(files.iter().map(|p| p.to_string_lossy().to_string()).collect()).map_err(|e| e.to_string());
        }
        if let Some(image) = image {
            let img = RustImageData::from_path(&image.to_string_lossy()).map_err(|e| e.to_string())?;
            return ctx.set_image(img).map_err(|e| e.to_string());
        }
        let mut contents = Vec::new();
        if let Some(text) = text {
            contents.push(ClipboardContent::Text(text));
        }
        if let Some(html) = html {
            contents.push(ClipboardContent::Html(html));
        }
        if contents.is_empty() {
            return Err("nichts zum Einfügen".into());
        }
        ctx.set(contents).map_err(|e| e.to_string())
    }

    /// Puts a clipboard item on the OS clipboard the way apps expect it.
    pub fn write_item(meta: &super::Meta, path: &Path) -> Result<(), String> {
        if super::is_text(&meta.mime) && meta.size <= 10 * 1024 * 1024 {
            let text = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
            return write(Some(text), None, None, &[]);
        }
        if meta.mime.starts_with("image/") && meta.mime != "image/svg+xml" && write(None, None, Some(path), &[]).is_ok() {
            return Ok(());
        }
        write(None, None, None, &[path.to_path_buf()])
    }

    pub enum Content {
        Files(Vec<PathBuf>),
        Png(Vec<u8>),
        Text { text: String, html: Option<String> },
        Empty,
    }

    /// What is on the clipboard: files, else an image, else text.
    pub fn read() -> Content {
        let Ok(ctx) = ctx() else { return Content::Empty };
        if ctx.has(ContentFormat::Files) {
            if let Ok(files) = ctx.get_files() {
                let files: Vec<PathBuf> = files.into_iter().map(|f| PathBuf::from(f.trim_start_matches("file://"))).filter(|p| p.is_file()).collect();
                if !files.is_empty() {
                    return Content::Files(files);
                }
            }
        }
        if ctx.has(ContentFormat::Image) && !ctx.has(ContentFormat::Text) {
            if let Some(png) = ctx.get_image().ok().and_then(|img| img.to_png().ok()) {
                return Content::Png(png.get_bytes().to_vec());
            }
        }
        match ctx.get_text() {
            Ok(text) if !text.is_empty() => Content::Text { text, html: ctx.get_html().ok().filter(|h| !h.is_empty()) },
            _ => {
                if let Some(png) = ctx.get_image().ok().and_then(|img| img.to_png().ok()) {
                    return Content::Png(png.get_bytes().to_vec());
                }
                Content::Empty
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_are_cleaned() {
        assert_eq!(clean_name("../../etc/passwd"), "passwd");
        assert_eq!(clean_name("C:\\x\\a<b>.txt"), "ab.txt");
        assert_eq!(clean_name(".hidden"), "hidden");
        assert_eq!(clean_name(""), "Datei");
    }

    #[test]
    fn store_round_trip_and_limits() {
        let store = Store::default();
        let meta = Meta::from_json(&serde_json::json!({ "id": "abc", "name": "a.txt", "size": 5 }), 3).unwrap();
        store.begin(meta).unwrap();
        assert!(store.get("abc").is_none(), "incomplete items are not served");
        assert_eq!(store.append("abc", b"hel").unwrap(), (3, false));
        assert!(store.append("abc", b"lo!!").is_err(), "more than announced");
        assert_eq!(store.append("abc", b"lo").unwrap(), (5, true));
        let (meta, path) = store.get("abc").unwrap();
        assert_eq!(fs::read(path).unwrap(), b"hello");
        assert_eq!(meta.text.as_deref(), Some("hello"));
        assert!(!store.remove("abc", 7), "only the sender or the presenter may remove");
        assert!(store.remove("abc", 3));
        assert!(Meta::from_json(&serde_json::json!({ "id": "x", "size": MAX_SIZE + 1 }), 1).is_err());
        assert!(Meta::from_json(&serde_json::json!({ "id": "../x", "size": 1 }), 1).is_err());
        store.clear();
    }
}
