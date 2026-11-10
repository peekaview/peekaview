//! Access log of the service and its helper: who came in through which link, when, and what they
//! did that matters (Strg+Alt+Entf, locking, disconnected on site). Keystrokes, PINs and passwords
//! are never written. One line per event, in `%ProgramData%\PeekaView\Fernzugriff.log` (Windows) or
//! `/Library/Application Support/PeekaView/Fernzugriff.log` (macOS, written by the daemon).

use std::time::{SystemTime, UNIX_EPOCH};

/// Longest name or field that goes into a line.
const MAX_FIELD: usize = 80;

/// Text from the network made safe for one log line: no line breaks or other control
/// characters (a viewer's name must not forge further entries), shortened.
pub fn clean(s: &str) -> String {
    let mut out: String = s.chars().map(|c| if c.is_control() { ' ' } else { c }).take(MAX_FIELD).collect();
    out = out.trim().to_string();
    if out.is_empty() {
        "–".into()
    } else {
        out
    }
}

/// "2026-11-09 14:03:07 UTC" for seconds since 1970.
pub fn timestamp(secs: u64) -> String {
    let days = (secs / 86_400) as i64;
    let rest = secs % 86_400;
    // days since 1970-01-01 → civil date (Howard Hinnant's algorithm)
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + i64::from(m <= 2);
    format!("{y:04}-{m:02}-{d:02} {:02}:{:02}:{:02} UTC", rest / 3600, rest / 60 % 60, rest % 60)
}

/// One log line (without the line break).
pub fn line(secs: u64, link: &str, viewer: &str, event: &str) -> String {
    format!("{}\t{}\t{}\t{}", timestamp(secs), clean(link), clean(viewer), clean(event))
}

/// A viewer as it appears in the log: their name and the start of their key.
pub fn viewer(name: &str, key: &str) -> String {
    let key: String = key.chars().filter(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '+' | '/')).take(8).collect();
    format!("{} ({key}…)", clean(name))
}

/// Appends an event to the access log (helper and service only; elsewhere it goes to the debug log).
pub fn event(link: &str, viewer: &str, event: &str) {
    let secs = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    let text = line(secs, link, viewer, event);
    crate::log(&format!("access: {text}"));
    // the macOS agent may run as the signed-in user: the daemon (root) writes the log
    #[cfg(target_os = "macos")]
    if super::helper() {
        super::mac::client::log(link, viewer, event);
        return;
    }
    if !super::privileged() {
        return;
    }
    use std::io::Write;
    let path = super::data_dir().join("Fernzugriff.log");
    let mut options = std::fs::OpenOptions::new();
    options.create(true).append(true);
    // only root (macOS) – Windows protects the folder with its ACL
    #[cfg(unix)]
    std::os::unix::fs::OpenOptionsExt::mode(&mut options, 0o600);
    if let Ok(mut f) = options.open(path) {
        let _ = writeln!(f, "{text}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn timestamps() {
        assert_eq!(timestamp(0), "1970-01-01 00:00:00 UTC");
        assert_eq!(timestamp(951_782_400), "2000-02-29 00:00:00 UTC");
        assert_eq!(timestamp(1_794_236_587), "2026-11-09 15:03:07 UTC");
    }

    #[test]
    fn lines_cannot_be_forged() {
        let l = line(0, "Büro", "Eve\n1970-01-01 00:00:00 UTC\tBüro\tAdmin\tverbunden", "verbunden");
        assert_eq!(l.lines().count(), 1);
        assert_eq!(l.matches('\t').count(), 3, "{l}");
        assert_eq!(clean("\u{7}\r\n "), "–");
        assert_eq!(clean(&"x".repeat(500)).chars().count(), MAX_FIELD);
    }

    #[test]
    fn viewers_show_name_and_key_start() {
        assert_eq!(viewer("Anna", "AbCdEfGh1234567890"), "Anna (AbCdEfGh…)");
        assert_eq!(viewer("", "\n\t<script>"), "– (script…)");
    }
}
