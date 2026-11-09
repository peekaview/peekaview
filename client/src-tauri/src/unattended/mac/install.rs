//! The setup step as root (`--install-service <app data dir>` / `--uninstall-service`), started by
//! the app through an administrator password prompt.
//!
//! The daemon and the agent must not run from a place a user can write to (`/Applications` belongs
//! to whoever dragged the app there): the step copies the signed app to
//! `/Library/Application Support/PeekaView/PeekaView.app` (root:wheel). Same bundle id, same
//! signature – the permissions for screen recording and accessibility apply to the copy as well.

use std::{
    os::unix::fs::PermissionsExt,
    path::{Path, PathBuf},
    process::{Command, Stdio},
};

use super::{
    super::{log, store},
    agent_plist, app_copy, daemon_plist, launchd_plist, AGENT_LABEL, DAEMON_LABEL, SUPPORT,
};

fn run(cmd: &str, args: &[&str]) -> Result<(), String> {
    let out = Command::new(cmd).args(args).stdin(Stdio::null()).output().map_err(|e| format!("{cmd}: {e}"))?;
    if out.status.success() {
        Ok(())
    } else {
        Err(format!("{cmd} {}: {}", args.join(" "), String::from_utf8_lossy(&out.stderr).trim()))
    }
}

/// `launchctl` errors when a job is not loaded – that is fine when taking it down.
fn bootout(target: &str) {
    let _ = run("/bin/launchctl", &["bootout", target]);
}

/// The .app this program runs from (…/X.app/Contents/MacOS/exe).
fn own_bundle() -> Result<(PathBuf, String), String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let name = exe.file_name().and_then(|n| n.to_str()).ok_or("exe name")?.to_string();
    let bundle = exe.parent().and_then(Path::parent).and_then(Path::parent).ok_or("no app bundle")?.to_path_buf();
    if bundle.extension().and_then(|e| e.to_str()) != Some("app") {
        return Err(format!("{} is not an app bundle", bundle.display()));
    }
    Ok((bundle, name))
}

fn write_file(path: &Path, bytes: &[u8], mode: u32) -> Result<(), String> {
    let tmp = path.with_extension("tmp");
    std::fs::write(&tmp, bytes).map_err(|e| format!("{}: {e}", tmp.display()))?;
    std::fs::set_permissions(&tmp, std::fs::Permissions::from_mode(mode)).map_err(|e| e.to_string())?;
    run("/usr/sbin/chown", &["root:wheel", &tmp.display().to_string()])?;
    std::fs::rename(&tmp, path).map_err(|e| format!("{}: {e}", path.display()))
}

/// The user on the screen, if somebody is signed in.
fn console_user() -> Option<u32> {
    super::peer::console_uid().filter(|&uid| uid != 0)
}

fn root_check() -> Result<(), String> {
    if super::console::root() {
        Ok(())
    } else {
        Err("needs root".into())
    }
}

/// `--install-service <dir>`: installs or updates daemon and agent with the links marked
/// "Auch ohne Anmeldung" in the user's app data `dir`.
pub fn install(dir: &Path) -> Result<(), String> {
    root_check()?;
    let links = store::from_app_dir(dir)?;
    if links.rooms.is_empty() {
        return uninstall();
    }
    let (bundle, exe_name) = own_bundle()?;
    let target = app_copy();

    // take everything down first: the files change underneath
    if let Some(uid) = console_user() {
        bootout(&format!("gui/{uid}/{AGENT_LABEL}"));
    }
    bootout(&format!("system/{DAEMON_LABEL}"));

    let support = Path::new(SUPPORT);
    std::fs::create_dir_all(support).map_err(|e| e.to_string())?;
    run("/usr/sbin/chown", &["root:wheel", SUPPORT])?;
    // users must reach the app copy inside; the store file itself is root only
    std::fs::set_permissions(support, std::fs::Permissions::from_mode(0o755)).map_err(|e| e.to_string())?;
    write_file(&store::path(), &serde_json::to_vec_pretty(&links).map_err(|e| e.to_string())?, 0o600)?;
    let _ = std::fs::set_permissions(support.join("Fernzugriff.log"), std::fs::Permissions::from_mode(0o600));

    // the app copy (unless this already is the copy: "Dienst aktualisieren" from the copy)
    if bundle != target {
        let staging = support.join("PeekaView.app.new");
        let _ = std::fs::remove_dir_all(&staging);
        run("/usr/bin/ditto", &[&bundle.display().to_string(), &staging.display().to_string()])?;
        run("/usr/sbin/chown", &["-R", "root:wheel", &staging.display().to_string()])?;
        run("/bin/chmod", &["-R", "go-w", &staging.display().to_string()])?;
        let _ = std::fs::remove_dir_all(&target);
        std::fs::rename(&staging, &target).map_err(|e| format!("{}: {e}", target.display()))?;
    }
    let exe = target.join("Contents/MacOS").join(&exe_name);

    write_file(&daemon_plist(), launchd_plist(false, &exe).as_bytes(), 0o644)?;
    write_file(&agent_plist(), launchd_plist(true, &exe).as_bytes(), 0o644)?;
    run("/bin/launchctl", &["bootstrap", "system", &daemon_plist().display().to_string()])?;
    // the agent of the session on the screen right now; at the login window and in later
    // sessions launchd loads it by itself
    if let Some(uid) = console_user() {
        if let Err(e) = run("/bin/launchctl", &["bootstrap", &format!("gui/{uid}"), &agent_plist().display().to_string()]) {
            crate::log(&format!("install: agent not started now: {e}"));
        }
    }
    log::event("–", "–", &format!("Dienst eingerichtet ({} Links)", links.rooms.len()));
    Ok(())
}

/// `--uninstall-service`: removes daemon, agent, the links and the app copy (the log stays).
pub fn uninstall() -> Result<(), String> {
    root_check()?;
    if let Some(uid) = console_user() {
        bootout(&format!("gui/{uid}/{AGENT_LABEL}"));
    }
    bootout(&format!("system/{DAEMON_LABEL}"));
    let _ = std::fs::remove_file(agent_plist());
    let _ = std::fs::remove_file(daemon_plist());
    let _ = std::fs::remove_file(store::path());
    let _ = std::fs::remove_file(super::SOCKET);
    let _ = std::fs::remove_dir_all(app_copy());
    log::event("–", "–", "Dienst entfernt");
    // agents of other sessions (fast user switching) find no daemon any more and stop serving
    Ok(())
}
