//! macOS: a LaunchDaemon (root, `--service`) holds the links, writes the access log and restarts
//! the Mac; a LaunchAgent (`--helper`) loaded for the login window (as root) and for every user
//! session (as that user) waits in the links, captures the screen and injects input – only the
//! agent of the session on the screen. They talk over a Unix socket (see `peer` for who may ask
//! what). Both run from a copy of the signed app in `/Library/Application Support/PeekaView`,
//! where only root may write.

// the pure parts (plists, quoting, restart rules) are built and tested everywhere
#![cfg_attr(not(target_os = "macos"), allow(dead_code))]

pub mod restart;

#[cfg(target_os = "macos")]
pub mod cf;
#[cfg(target_os = "macos")]
pub mod console;
#[cfg(target_os = "macos")]
pub mod client;
#[cfg(target_os = "macos")]
pub mod indicator;
#[cfg(target_os = "macos")]
pub mod install;
#[cfg(target_os = "macos")]
pub mod peer;
#[cfg(target_os = "macos")]
pub mod service;

use std::path::{Path, PathBuf};

pub const DAEMON_LABEL: &str = "de.limtec.peekaview.service";
pub const AGENT_LABEL: &str = "de.limtec.peekaview.agent";
pub const BUNDLE_ID: &str = "de.limtec.peekaview";
pub const SOCKET: &str = "/var/run/de.limtec.peekaview.sock";
pub const SUPPORT: &str = "/Library/Application Support/PeekaView";

pub fn app_copy() -> PathBuf {
    Path::new(SUPPORT).join("PeekaView.app")
}

pub fn daemon_plist() -> PathBuf {
    PathBuf::from(format!("/Library/LaunchDaemons/{DAEMON_LABEL}.plist"))
}

pub fn agent_plist() -> PathBuf {
    PathBuf::from(format!("/Library/LaunchAgents/{AGENT_LABEL}.plist"))
}

/// Text for an XML property list.
pub fn xml_escape(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&apos;"),
            // not allowed in XML 1.0 at all
            c if (c as u32) < 0x20 && !matches!(c, '\t' | '\n' | '\r') => {}
            c => out.push(c),
        }
    }
    out
}

const PLIST_HEAD: &str = r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
"#;

/// The launchd job of the daemon or the agent, running `exe` with `--service` / `--helper`.
pub fn launchd_plist(agent: bool, exe: &Path) -> String {
    let (label, flag) = if agent { (AGENT_LABEL, "--helper") } else { (DAEMON_LABEL, "--service") };
    let sessions = if agent {
        "  <key>LimitLoadToSessionType</key>\n  <array>\n    <string>LoginWindow</string>\n    <string>Aqua</string>\n  </array>\n  <key>ProcessType</key>\n  <string>Interactive</string>\n"
    } else {
        ""
    };
    format!(
        "{PLIST_HEAD}<dict>\n  <key>Label</key>\n  <string>{label}</string>\n  <key>ProgramArguments</key>\n  <array>\n    <string>{}</string>\n    <string>{flag}</string>\n  </array>\n{sessions}  <key>RunAtLoad</key>\n  <true/>\n  <key>KeepAlive</key>\n  <true/>\n  <key>ThrottleInterval</key>\n  <integer>5</integer>\n  <key>AssociatedBundleIdentifiers</key>\n  <string>{BUNDLE_ID}</string>\n</dict>\n</plist>\n",
        xml_escape(&exe.display().to_string())
    )
}

/// One argument for `/bin/sh`.
pub fn shell_quote(arg: &str) -> String {
    format!("'{}'", arg.replace('\'', r"'\''"))
}

/// An AppleScript string literal.
pub fn applescript_string(s: &str) -> String {
    format!("\"{}\"", s.replace('\\', r"\\").replace('"', "\\\""))
}

/// The AppleScript that runs `exe args…` as root after asking for an administrator's password.
pub fn admin_script(exe: &Path, args: &[String], prompt: &str) -> String {
    let command = std::iter::once(exe.display().to_string()).chain(args.iter().cloned()).map(|a| shell_quote(&a)).collect::<Vec<_>>().join(" ");
    format!("do shell script {} with prompt {} with administrator privileges", applescript_string(&command), applescript_string(prompt))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plists() {
        let exe = Path::new("/Library/Application Support/PeekaView/PeekaView.app/Contents/MacOS/peekaview");
        let agent = launchd_plist(true, exe);
        assert!(agent.contains("<string>de.limtec.peekaview.agent</string>"));
        assert!(agent.contains("<string>--helper</string>"));
        assert!(agent.contains("<string>LoginWindow</string>") && agent.contains("<string>Aqua</string>"));
        assert!(agent.contains("<string>/Library/Application Support/PeekaView/PeekaView.app/Contents/MacOS/peekaview</string>"));
        let daemon = launchd_plist(false, exe);
        assert!(daemon.contains("<string>--service</string>"));
        assert!(!daemon.contains("LimitLoadToSessionType"), "a daemon has no sessions");
        assert!(launchd_plist(false, Path::new("/a&b/<x>")).contains("<string>/a&amp;b/&lt;x&gt;</string>"));
    }

    #[test]
    fn xml_escaping() {
        assert_eq!(xml_escape(r#"a<b>&"c'"#), "a&lt;b&gt;&amp;&quot;c&apos;");
        assert_eq!(xml_escape("x\u{0}\u{1b}y\tz"), "xy\tz");
    }

    #[test]
    fn admin_script_quotes_everything() {
        let exe = Path::new("/Applications/Peeka View.app/Contents/MacOS/peekaview");
        let args = vec!["--install-service".to_string(), r#"/Users/a'b/Library/x"y\z"#.to_string()];
        let script = admin_script(exe, &args, "PeekaView \"Fernzugriff\"");
        assert_eq!(
            script,
            r#"do shell script "'/Applications/Peeka View.app/Contents/MacOS/peekaview' '--install-service' '/Users/a'\\''b/Library/x\"y\\z'" with prompt "PeekaView \"Fernzugriff\"" with administrator privileges"#
        );
        assert_eq!(shell_quote("$(rm -rf /)"), "'$(rm -rf /)'");
    }
}
