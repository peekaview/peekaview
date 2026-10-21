//! Session recording → a self-contained HTML report.
//!
//! * a screenshot of the shared source on every click / ping (position marked) and after text
//!   entry (Enter or a typing pause) – the typed text itself is never recorded
//! * a transcript of the conversation: Apple Speech on-device on macOS when possible, otherwise
//!   OpenAI (`gpt-4o-transcribe`) with the presenter's API key
//!
//! Audio arrives from the PeekaView window as 16 kHz mono PCM (own microphone + all voice chat partners)
//! and is transcribed in 20 s chunks while the session runs.

use std::{
    collections::HashMap,
    io::Cursor,
    path::PathBuf,
    sync::{Arc, Mutex},
    thread::{self, JoinHandle},
    time::{Duration, Instant},
};

use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde_json::Value;
use xcap::image::{codecs::jpeg::JpegEncoder, imageops, DynamicImage};

use crate::video::Source;

const SAMPLE_RATE: usize = 16_000;
const CHUNK_SECS: usize = 20;
const SHOT_DEDUPE: Duration = Duration::from_millis(450);
const TYPING_PAUSE: Duration = Duration::from_millis(1500);
const SHOT_MAX_W: u32 = 1600;

#[derive(Clone)]
pub enum Engine {
    #[cfg(target_os = "macos")]
    Apple,
    OpenAi(String),
    None,
}

impl Engine {
    fn label(&self) -> &'static str {
        match self {
            #[cfg(target_os = "macos")]
            Engine::Apple => "Apple-Spracherkennung (lokal auf dem Mac)",
            Engine::OpenAi(_) => "OpenAI gpt-4o-transcribe",
            Engine::None => "keine (kein Transkript)",
        }
    }
}

pub struct Options {
    pub title: String,
    pub started_label: String,
    pub file_stamp: String,
    pub engine: Engine,
}

struct Shot {
    at: Duration,
    label: String,
    pos: Option<(f64, f64)>,
    jpeg: Option<Vec<u8>>,
}

struct Segment {
    at: f64,
    text: String,
}

pub struct Recorder {
    started: Instant,
    opts: Options,
    source: Mutex<Source>,
    shots: Arc<Mutex<Vec<Shot>>>,
    last_shot: Mutex<Option<Instant>>,
    audio: Mutex<(Vec<i16>, usize)>,
    segments: Arc<Mutex<Vec<Segment>>>,
    workers: Mutex<Vec<JoinHandle<()>>>,
    names: Mutex<HashMap<u64, String>>,
    typing: Mutex<Option<(Instant, String)>>,
}

impl Recorder {
    pub fn new(source: Source, opts: Options) -> Arc<Self> {
        Arc::new(Recorder {
            started: Instant::now(),
            opts,
            source: Mutex::new(source),
            shots: Arc::default(),
            last_shot: Mutex::new(None),
            audio: Mutex::new((Vec::new(), 0)),
            segments: Arc::default(),
            workers: Mutex::default(),
            names: Mutex::default(),
            typing: Mutex::new(None),
        })
    }

    /// The share switched to another screen or window.
    pub fn set_source(&self, source: Source) {
        *self.source.lock().unwrap() = source;
    }

    pub fn engine_label(&self) -> &'static str {
        self.opts.engine.label()
    }

    pub fn set_peers(&self, list: &Value) {
        let mut names = self.names.lock().unwrap();
        for p in list.as_array().into_iter().flatten() {
            if let (Some(id), Some(name)) = (p["id"].as_u64(), p["name"].as_str()) {
                names.insert(id, name.to_string());
            }
        }
    }

    pub fn name(&self, id: u64) -> String {
        self.names.lock().unwrap().get(&id).cloned().unwrap_or_else(|| if id == 0 { "Teilende Person".into() } else { "Gast".into() })
    }

    /// Takes a screenshot of the shared source now. `pos` = normalized click position.
    pub fn shot(&self, label: String, pos: Option<(f64, f64)>) {
        {
            let mut last = self.last_shot.lock().unwrap();
            if last.is_some_and(|t| t.elapsed() < SHOT_DEDUPE) {
                return;
            }
            *last = Some(Instant::now());
        }
        let at = self.started.elapsed();
        let source = self.source.lock().unwrap().clone();
        let shots = self.shots.clone();
        let handle = thread::spawn(move || {
            let image = match &source {
                Source::Screen(m) => m.capture_image(),
                Source::Window(w) => w.capture_image(),
            };
            let jpeg = image.ok().and_then(|img| {
                let (w, h) = img.dimensions();
                let img = if w > SHOT_MAX_W {
                    imageops::resize(&img, SHOT_MAX_W, h * SHOT_MAX_W / w, imageops::FilterType::Triangle)
                } else {
                    img
                };
                let mut out = Vec::new();
                JpegEncoder::new_with_quality(&mut out, 80).encode_image(&DynamicImage::ImageRgba8(img).to_rgb8()).ok()?;
                Some(out)
            });
            shots.lock().unwrap().push(Shot { at, label, pos, jpeg });
        });
        self.workers.lock().unwrap().push(handle);
    }

    /// Somebody is typing; a screenshot follows on Enter or after a pause.
    pub fn typed(&self, who: String) {
        *self.typing.lock().unwrap() = Some((Instant::now(), who));
    }

    pub fn enter(&self, who: String) {
        self.typing.lock().unwrap().take();
        self.shot(format!("Texteingabe (Enter) – {who}"), None);
    }

    /// Called regularly: a typing pause ends a text entry.
    pub fn tick(&self) {
        let ended = {
            let mut typing = self.typing.lock().unwrap();
            match typing.as_ref() {
                Some((t, _)) if t.elapsed() >= TYPING_PAUSE => typing.take(),
                _ => None,
            }
        };
        if let Some((_, who)) = ended {
            self.shot(format!("Texteingabe – {who}"), None);
        }
    }

    /// 16 kHz mono PCM, little-endian i16.
    pub fn audio(&self, bytes: &[u8]) {
        let mut audio = self.audio.lock().unwrap();
        audio.0.extend(bytes.chunks_exact(2).map(|b| i16::from_le_bytes([b[0], b[1]])));
        while audio.0.len() >= CHUNK_SECS * SAMPLE_RATE {
            let rest = audio.0.split_off(CHUNK_SECS * SAMPLE_RATE);
            let chunk = std::mem::replace(&mut audio.0, rest);
            let at = audio.1 as f64 / SAMPLE_RATE as f64;
            audio.1 += chunk.len();
            self.transcribe(chunk, at);
        }
    }

    fn transcribe(&self, samples: Vec<i16>, at: f64) {
        // skip silence: no API call, no hallucinated text
        let rms = (samples.iter().map(|s| (*s as f64).powi(2)).sum::<f64>() / samples.len().max(1) as f64).sqrt();
        if rms < 200.0 || matches!(self.opts.engine, Engine::None) {
            return;
        }
        let engine = self.opts.engine.clone();
        let segments = self.segments.clone();
        let handle = thread::spawn(move || {
            let wav = wav(&samples);
            let text = match engine {
                #[cfg(target_os = "macos")]
                Engine::Apple => crate::speech::transcribe(&wav),
                Engine::OpenAi(key) => openai(&key, &wav),
                Engine::None => None,
            };
            match text {
                Some(text) if !text.trim().is_empty() => segments.lock().unwrap().push(Segment { at, text: text.trim().to_string() }),
                Some(_) => {}
                None => crate::log("recording: transcription of a chunk failed"),
            }
        });
        self.workers.lock().unwrap().push(handle);
    }

    /// Finishes transcription and writes the report. Returns its path.
    pub fn finish(&self) -> Result<PathBuf, String> {
        {
            let mut audio = self.audio.lock().unwrap();
            let rest = std::mem::take(&mut audio.0);
            let at = audio.1 as f64 / SAMPLE_RATE as f64;
            if rest.len() > SAMPLE_RATE {
                self.transcribe(rest, at);
            }
        }
        let workers = std::mem::take(&mut *self.workers.lock().unwrap());
        for w in workers {
            let _ = w.join();
        }

        let dir = std::env::var_os("PEEKAVIEW_REPORT_DIR").map(PathBuf::from).unwrap_or_else(|| dirs_documents().join("PeekaView"));
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let path = dir.join(format!("PeekaView-Sitzung-{}.html", self.opts.file_stamp));
        std::fs::write(&path, self.render()).map_err(|e| e.to_string())?;
        Ok(path)
    }

    fn render(&self) -> String {
        let mut shots = std::mem::take(&mut *self.shots.lock().unwrap());
        shots.sort_by_key(|s| s.at);
        let mut segments = std::mem::take(&mut *self.segments.lock().unwrap());
        segments.sort_by(|a, b| a.at.total_cmp(&b.at));
        let mut names: Vec<String> = self.names.lock().unwrap().values().cloned().collect();
        names.sort();

        let speech = |from: f64, to: f64| -> String {
            let lines: String = segments
                .iter()
                .filter(|s| s.at >= from && s.at < to)
                .map(|s| format!("<p><time>{}</time>{}</p>", clock(s.at), esc(&s.text)))
                .collect();
            if lines.is_empty() { String::new() } else { format!("<div class=\"speech\">{lines}</div>") }
        };

        let mut body = String::new();
        let first = shots.first().map(|s| s.at.as_secs_f64()).unwrap_or(f64::MAX);
        body.push_str(&speech(0.0, first));
        for (i, shot) in shots.iter().enumerate() {
            let at = shot.at.as_secs_f64();
            let next = shots.get(i + 1).map(|s| s.at.as_secs_f64()).unwrap_or(f64::MAX);
            let marker = shot
                .pos
                .map(|(x, y)| format!("<span class=\"marker\" style=\"left:{:.2}%;top:{:.2}%\"></span>", x * 100.0, y * 100.0))
                .unwrap_or_default();
            let image = shot
                .jpeg
                .as_ref()
                .map(|j| format!("<figure><img src=\"data:image/jpeg;base64,{}\" alt=\"\">{marker}</figure>", STANDARD.encode(j)))
                .unwrap_or_else(|| "<p class=\"missing\">Screenshot nicht verfügbar</p>".into());
            body.push_str(&format!(
                "<article><header><time>{}</time><h2>{}</h2></header>{image}{}</article>",
                clock(at),
                esc(&shot.label),
                speech(at, next)
            ));
        }
        if shots.is_empty() && segments.is_empty() {
            body.push_str("<p class=\"missing\">In dieser Sitzung wurde nichts aufgezeichnet.</p>");
        }

        format!(
            r#"<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>PeekaView – Sitzung {started}</title>
<style>
  :root {{ --accent: #ef4444; --fg: #18181b; --muted: #71717a; --line: #e4e4e7; font: 15px/1.55 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; color: var(--fg); }}
  body {{ max-width: 980px; margin: 0 auto; padding: 40px 24px 80px; background: #fafafa; }}
  .head {{ display: flex; align-items: center; gap: 14px; margin-bottom: 8px; }}
  .logo {{ display: grid; place-items: center; width: 40px; height: 40px; border-radius: 11px; background: var(--accent); color: #fff; font-weight: 700; }}
  h1 {{ margin: 0; font-size: 24px; letter-spacing: -.02em; }}
  dl {{ display: grid; grid-template-columns: max-content 1fr; gap: 4px 18px; margin: 18px 0 36px; padding: 16px 20px; border-radius: 14px; background: #fff; border: 1px solid var(--line); }}
  dt {{ color: var(--muted); }} dd {{ margin: 0; }}
  article {{ margin: 0 0 32px; padding: 20px; border-radius: 16px; background: #fff; border: 1px solid var(--line); }}
  article header {{ display: flex; align-items: baseline; gap: 12px; margin-bottom: 12px; }}
  article time, .speech time {{ font: 600 13px ui-monospace, "SF Mono", Menlo, monospace; color: var(--accent); }}
  h2 {{ margin: 0; font-size: 16px; }}
  figure {{ position: relative; margin: 0; border-radius: 10px; overflow: hidden; border: 1px solid var(--line); }}
  figure img {{ display: block; width: 100%; }}
  .marker {{ position: absolute; width: 34px; height: 34px; margin: -17px 0 0 -17px; border: 3px solid var(--accent); border-radius: 50%; box-shadow: 0 0 0 4px rgba(239, 68, 68, .25); }}
  .speech {{ margin: 14px 0 0; padding: 12px 16px; border-left: 3px solid var(--line); background: #f4f4f5; border-radius: 0 10px 10px 0; }}
  .speech p {{ margin: 0 0 6px; }} .speech time {{ margin-right: 10px; }}
  .missing {{ color: var(--muted); }}
  footer {{ margin-top: 40px; color: var(--muted); font-size: 13px; }}
</style>
</head>
<body>
<div class="head"><div class="logo">PV</div><h1>Sitzungsbericht</h1></div>
<dl>
  <dt>Geteilt</dt><dd>{title}</dd>
  <dt>Beginn</dt><dd>{started}</dd>
  <dt>Dauer</dt><dd>{duration}</dd>
  <dt>Teilnehmende</dt><dd>{names}</dd>
  <dt>Screenshots</dt><dd>{count}</dd>
  <dt>Transkript</dt><dd>{engine}</dd>
</dl>
{body}
<footer>Erstellt mit PeekaView. Tastatureingaben werden nicht protokolliert, nur Screenshots nach einer Eingabe.</footer>
</body>
</html>
"#,
            title = esc(&self.opts.title),
            started = esc(&self.opts.started_label),
            duration = clock(self.started.elapsed().as_secs_f64()),
            names = esc(&names.join(", ")),
            count = shots.len(),
            engine = self.engine_label(),
        )
    }
}

fn esc(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;")
}

fn clock(secs: f64) -> String {
    let s = secs.max(0.0) as u64;
    if s >= 3600 { format!("{}:{:02}:{:02}", s / 3600, s / 60 % 60, s % 60) } else { format!("{:02}:{:02}", s / 60, s % 60) }
}

fn dirs_documents() -> PathBuf {
    let home = std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE")).map(PathBuf::from).unwrap_or_else(std::env::temp_dir);
    let docs = home.join("Documents");
    if docs.is_dir() { docs } else { home }
}

/// 16 kHz mono 16-bit WAV.
pub fn wav(samples: &[i16]) -> Vec<u8> {
    let data_len = (samples.len() * 2) as u32;
    let mut out = Cursor::new(Vec::with_capacity(44 + data_len as usize));
    let mut put = |b: &[u8]| out.get_mut().extend_from_slice(b);
    put(b"RIFF");
    put(&(36 + data_len).to_le_bytes());
    put(b"WAVEfmt ");
    put(&16u32.to_le_bytes());
    put(&1u16.to_le_bytes());
    put(&1u16.to_le_bytes());
    put(&(SAMPLE_RATE as u32).to_le_bytes());
    put(&(SAMPLE_RATE as u32 * 2).to_le_bytes());
    put(&2u16.to_le_bytes());
    put(&16u16.to_le_bytes());
    put(b"data");
    put(&data_len.to_le_bytes());
    for s in samples {
        put(&s.to_le_bytes());
    }
    out.into_inner()
}

fn openai(key: &str, wav: &[u8]) -> Option<String> {
    let boundary = "peekaview-boundary-7f3a9c";
    let mut body = Vec::with_capacity(wav.len() + 512);
    for (name, value) in [("model", "gpt-4o-transcribe"), ("response_format", "json")] {
        body.extend_from_slice(format!("--{boundary}\r\nContent-Disposition: form-data; name=\"{name}\"\r\n\r\n{value}\r\n").as_bytes());
    }
    body.extend_from_slice(
        format!("--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"chunk.wav\"\r\nContent-Type: audio/wav\r\n\r\n").as_bytes(),
    );
    body.extend_from_slice(wav);
    body.extend_from_slice(format!("\r\n--{boundary}--\r\n").as_bytes());

    let response = ureq::post("https://api.openai.com/v1/audio/transcriptions")
        .header("Authorization", &format!("Bearer {key}"))
        .header("Content-Type", &format!("multipart/form-data; boundary={boundary}"))
        .send(&body[..]);
    match response {
        Ok(mut r) => {
            let v: Value = serde_json::from_str(&r.body_mut().read_to_string().ok()?).ok()?;
            v["text"].as_str().map(str::to_string)
        }
        Err(e) => {
            crate::log(&format!("recording: OpenAI request failed: {e}"));
            None
        }
    }
}

/// OPENAI_API_KEY from the environment or a .env file: (key, where it was found).
pub fn env_key() -> Option<(String, String)> {
    if let Ok(key) = std::env::var("OPENAI_API_KEY") {
        if !key.trim().is_empty() {
            return Some((key.trim().to_string(), "Umgebungsvariable OPENAI_API_KEY".into()));
        }
    }
    let home = std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE")).map(PathBuf::from);
    let mut candidates = Vec::new();
    if let Some(home) = &home {
        candidates.push(home.join(".peekaview").join(".env"));
        candidates.push(home.join(".env"));
    }
    candidates.push(PathBuf::from(".env"));
    for path in candidates {
        let Ok(content) = std::fs::read_to_string(&path) else { continue };
        for line in content.lines() {
            let line = line.trim().trim_start_matches("export ").trim();
            if let Some(value) = line.strip_prefix("OPENAI_API_KEY=") {
                let value = value.trim().trim_matches('"').trim_matches('\'');
                if !value.is_empty() {
                    let shown = match &home {
                        Some(h) => path.strip_prefix(h).map(|p| format!("~/{}", p.display())).unwrap_or_else(|_| path.display().to_string()),
                        None => path.display().to_string(),
                    };
                    return Some((value.to_string(), shown));
                }
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wav_header() {
        let w = wav(&[0, 1, -1]);
        assert_eq!(&w[..4], b"RIFF");
        assert_eq!(&w[8..16], b"WAVEfmt ");
        assert_eq!(w.len(), 44 + 6);
        assert_eq!(u32::from_le_bytes(w[24..28].try_into().unwrap()), 16_000);
    }

    #[test]
    fn clock_format() {
        assert_eq!(clock(5.4), "00:05");
        assert_eq!(clock(3725.0), "1:02:05");
    }

    /// Screenshots of the primary display through the real code path; writes a report to
    /// PEEKAVIEW_REPORT_DIR. Needs the screen recording permission: `cargo test -- --ignored`
    #[test]
    #[ignore]
    fn live_report() {
        let monitor = xcap::Monitor::all().unwrap().into_iter().find(|m| m.is_primary().unwrap_or(false)).unwrap();
        let rec = Recorder::new(
            Source::Screen(monitor),
            Options { title: "Bildschirm 1".into(), started_label: "Testlauf".into(), file_stamp: "test".into(), engine: Engine::None },
        );
        rec.set_peers(&serde_json::json!([{ "id": 0, "name": "Pat", "host": true }, { "id": 1, "name": "Anna" }]));
        rec.shot(format!("Klick – {}", rec.name(0)), Some((0.25, 0.4)));
        std::thread::sleep(Duration::from_millis(600));
        rec.shot(format!("Zeigen – {}", rec.name(1)), Some((0.7, 0.2)));
        std::thread::sleep(Duration::from_millis(600));
        rec.typed(rec.name(1));
        rec.enter(rec.name(1));
        rec.segments.lock().unwrap().push(Segment { at: 0.2, text: "Hallo zusammen, ich teile jetzt meinen Bildschirm.".into() });
        rec.segments.lock().unwrap().push(Segment { at: 0.9, text: "Hier oben siehst du das Menü.".into() });
        let path = rec.finish().unwrap();
        let html = std::fs::read_to_string(&path).unwrap();
        assert_eq!(html.matches("<article>").count(), 3);
        assert!(html.contains("Klick – Pat") && html.contains("Zeigen – Anna") && html.contains("Texteingabe (Enter) – Anna"));
        assert!(html.contains("Hier oben siehst du das Menü."));
        println!("{}", path.display());
    }
}
