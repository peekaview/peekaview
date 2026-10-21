//! The presenter's lock screen. In a room with remote access the viewer may unlock it: the
//! password they enter is typed into the lock screen like on a keyboard – it is never stored or
//! logged. macOS only; Windows keeps its lock screen on a secure desktop no app can type into.

use std::{
    sync::Mutex,
    time::{Duration, Instant},
};

/// Is the presenter's screen locked?
pub fn locked() -> bool {
    imp::locked()
}

/// unlock attempts in the last minute – the lock screen is no place to guess passwords
static ATTEMPTS: Mutex<Vec<Instant>> = Mutex::new(Vec::new());
const MAX_ATTEMPTS: usize = 3;

/// Types `password` into the lock screen and tells whether the screen got unlocked.
pub fn unlock(password: &str) -> Result<(), String> {
    if !locked() {
        return Ok(());
    }
    if password.is_empty() || password.len() > 256 {
        return Err("Bitte das Passwort eingeben.".into());
    }
    {
        let mut attempts = ATTEMPTS.lock().unwrap();
        attempts.retain(|t| t.elapsed() < Duration::from_secs(60));
        if attempts.len() >= MAX_ATTEMPTS {
            return Err("Zu viele Versuche – bitte in einer Minute noch einmal.".into());
        }
        attempts.push(Instant::now());
    }
    if !crate::guard::accessibility() {
        return Err("Beim Host fehlt die Freigabe „Bedienungshilfen“.".into());
    }
    imp::type_password(password)?;
    // the lock screen takes a moment to check the password
    for _ in 0..16 {
        std::thread::sleep(Duration::from_millis(250));
        if !locked() {
            return Ok(());
        }
    }
    Err("Entsperren fehlgeschlagen – Passwort falsch?".into())
}

#[cfg(target_os = "macos")]
mod imp {
    use std::time::Duration;

    use enigo::{Direction, Enigo, Key, Keyboard, Settings};
    use objc2_core_foundation::{CFBoolean, CFString};
    use objc2_core_graphics::CGSessionCopyCurrentDictionary;

    pub fn locked() -> bool {
        let Some(dict) = CGSessionCopyCurrentDictionary() else { return false };
        let key = CFString::from_str("CGSSessionScreenIsLocked");
        let value = unsafe { dict.value((key.as_ref() as *const CFString).cast()) } as *const CFBoolean;
        !value.is_null() && unsafe { (*value).value() }
    }

    pub fn type_password(password: &str) -> Result<(), String> {
        // wake the display, then a harmless key brings up the password field
        let _ = std::process::Command::new("caffeinate").args(["-u", "-t", "2"]).spawn();
        std::thread::sleep(Duration::from_millis(700));
        let mut enigo = Enigo::new(&Settings { open_prompt_to_get_permissions: false, ..Default::default() }).map_err(|e| e.to_string())?;
        let _ = enigo.key(Key::Shift, Direction::Click);
        std::thread::sleep(Duration::from_millis(600));
        // characters, not key codes: independent of the keyboard layout (no y/z swaps)
        for c in password.chars() {
            enigo.text(&c.to_string()).map_err(|e| e.to_string())?;
            std::thread::sleep(Duration::from_millis(15));
        }
        enigo.key(Key::Return, Direction::Click).map_err(|e| e.to_string())
    }
}

#[cfg(not(target_os = "macos"))]
mod imp {
    pub fn locked() -> bool {
        false
    }

    pub fn type_password(_: &str) -> Result<(), String> {
        Err("Entsperren aus der Ferne gibt es nur am Mac.".into())
    }
}
