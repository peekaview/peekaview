//! Archive of the existing self-contained session reports; no second database to keep in sync.
use std::{io::BufRead, path::PathBuf};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

#[derive(Serialize)]
pub struct Entry {
    id: String,
    title: String,
    date: String,
    day: String,
    thumbnail: Option<String>,
    conversation: Option<crate::recording::Conversation>,
}

fn valid_id(id: &str) -> bool {
    id.strip_prefix("PeekaView-Sitzung-").and_then(|s| s.strip_suffix(".html"))
        .is_some_and(|s| !s.is_empty() && s.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_'))
}

fn between<'a>(text: &'a str, before: &str, after: &str) -> Option<&'a str> {
    text.split_once(before)?.1.split_once(after).map(|(value, _)| value)
}

fn unescape(text: &str) -> String {
    text.replace("&quot;", "\"").replace("&gt;", ">").replace("&lt;", "<").replace("&amp;", "&")
}

fn entry(id: String, html: &str) -> Result<Entry, String> {
    let title = between(html, "<dt>Geteilt</dt><dd>", "</dd>").ok_or("Ungültiger Sitzungsbericht")?;
    let date = between(html, "<dt>Beginn</dt><dd>", "</dd>").ok_or("Datum fehlt im Sitzungsbericht")?;
    let day = id.trim_start_matches("PeekaView-Sitzung-").chars().take(10).collect();
    let thumbnail = between(html, "<img src=\"data:image/jpeg;base64,", "\"")
        .map(|image| format!("data:image/jpeg;base64,{image}"));
    let conversation = between(html, "<meta name=\"peekaview-conversation\" content=\"", "\">")
        .map(|value| serde_json::from_str(&unescape(value)).map_err(|e| format!("Ungültige Transkriptzuordnung: {e}"))).transpose()?;
    Ok(Entry { id, title: unescape(title), date: unescape(date), day, thumbnail, conversation })
}

pub fn list() -> Result<Vec<Entry>, String> {
    let dir = crate::recording::report_dir();
    if !dir.exists() { return Ok(vec![]); }
    let mut entries = Vec::new();
    for file in std::fs::read_dir(&dir).map_err(|e| e.to_string())? {
        let file = file.map_err(|e| e.to_string())?;
        let id = file.file_name().to_string_lossy().into_owned();
        if !valid_id(&id) { continue; }
        // The title and first screenshot are enough for a thumbnail; don't load every report's full timeline.
        let mut reader = std::io::BufReader::new(std::fs::File::open(path(&id)?).map_err(|e| e.to_string())?);
        let mut html = Vec::new();
        loop {
            let mut tag = Vec::new();
            if reader.read_until(b'>', &mut tag).map_err(|e| e.to_string())? == 0 { break; }
            let image = tag.windows(b"<img src=\"data:image/jpeg;base64,".len()).any(|part| part == b"<img src=\"data:image/jpeg;base64,");
            html.extend(tag);
            if image { break; }
        }
        let html = String::from_utf8(html).map_err(|e| e.to_string())?;
        entries.push(entry(id, &html)?);
    }
    entries.sort_by(|a, b| b.id.cmp(&a.id));
    Ok(entries)
}

pub fn read(id: &str) -> Result<String, String> {
    std::fs::read_to_string(path(id)?).map_err(|e| e.to_string())
}

fn path(id: &str) -> Result<PathBuf, String> {
    if !valid_id(id) { return Err("Ungültiges Transkript".into()); }
    let dir = crate::recording::report_dir().canonicalize().map_err(|e| e.to_string())?;
    let path = dir.join(id).canonicalize().map_err(|e| e.to_string())?;
    if path.parent() != Some(dir.as_path()) { return Err("Transkript liegt außerhalb des Archivs".into()); }
    Ok(path)
}

pub fn open(app: &AppHandle, id: Option<&str>) -> Result<(), String> {
    if let Some(id) = id { read(id)?; }
    let label = id.map(|id| format!("transcript-{}", id.trim_end_matches(".html"))).unwrap_or_else(|| "transcripts".into());
    if let Some(window) = app.get_webview_window(&label) {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
        return Ok(());
    }
    let url = id.map(|id| format!("desktop/transcripts.html?id={id}")).unwrap_or_else(|| "desktop/transcripts.html".into());
    crate::set_dock(app, true);
    tauri::WebviewWindowBuilder::new(app, label, tauri::WebviewUrl::App(url.into()))
        .title(if id.is_some() { "PeekaView – Transkript" } else { "PeekaView – Transkripte" })
        .inner_size(if id.is_some() { 900.0 } else { 700.0 }, 720.0)
        .min_inner_size(520.0, 480.0)
        .theme(Some(tauri::Theme::Dark))
        .build().map_err(|e| e.to_string())?;
    Ok(())
}

pub fn saved(app: &AppHandle, path: &std::path::Path) {
    let _ = app.emit("transcripts-changed", path.file_name().map(|s| s.to_string_lossy().into_owned()));
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn archive_ids_cannot_address_other_files() {
        assert!(valid_id("PeekaView-Sitzung-2026-10-22_12-30.html"));
        for id in ["../settings.json", "PeekaView-Sitzung-../secret.html", "PeekaView-Sitzung-.html", "/tmp/report.html"] {
            assert!(!valid_id(id));
        }
    }
    #[test]
    fn existing_reports_supply_the_archive_metadata() {
        let html = "<dt>Geteilt</dt><dd>Editor &amp; Browser</dd><dt>Beginn</dt><dd>22. Oktober 2026</dd><img src=\"data:image/jpeg;base64,YQ==\">";
        let entry = entry("PeekaView-Sitzung-2026-10-22_12-30.html".into(), html).unwrap();
        assert_eq!(entry.title, "Editor & Browser");
        assert_eq!(entry.day, "2026-10-22");
        assert_eq!(entry.thumbnail.as_deref(), Some("data:image/jpeg;base64,YQ=="));
        assert!(entry.conversation.is_none());
        assert!(super::entry("x".into(), "<script>not a report</script>").is_err());
    }

    #[test]
    fn reports_retain_the_conversation_without_ambiguous_names() {
        let html = "<meta name=\"peekaview-conversation\" content=\"{&quot;id&quot;:&quot;a123&quot;,&quot;kind&quot;:&quot;group&quot;,&quot;name&quot;:&quot;Team &amp; Partner&quot;}\"><dt>Geteilt</dt><dd>Editor</dd><dt>Beginn</dt><dd>23. Oktober 2026</dd>";
        let entry = entry("PeekaView-Sitzung-2026-10-23_12-30.html".into(), html).unwrap();
        let conversation = entry.conversation.unwrap();
        assert_eq!(conversation.id, "a123");
        assert_eq!(conversation.kind, "group");
        assert_eq!(conversation.name, "Team & Partner");
    }
}
