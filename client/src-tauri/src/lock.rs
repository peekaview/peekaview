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

/// Locks the presenter's screen, as "Bildschirm sperren" in the Apple menu does. A share in which
/// a viewer unlocked the screen ends with this: nobody finds the computer open afterwards.
pub fn lock() {
    imp::lock()
}

#[cfg(target_os = "macos")]
mod imp {
    use std::ffi::{c_char, c_int, c_void};
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

    extern "C" {
        fn dlopen(path: *const c_char, mode: c_int) -> *mut c_void;
        fn dlsym(handle: *mut c_void, symbol: *const c_char) -> *mut c_void;
    }
    const RTLD_LAZY: c_int = 1;

    /// loginwindow's "lock now" – macOS has no public call for it. Looked up at run time: a
    /// system without it leaves the screen as it is instead of keeping PeekaView from starting.
    fn lock_now() -> Option<unsafe extern "C" fn()> {
        let call = unsafe {
            let login = dlopen(c"/System/Library/PrivateFrameworks/login.framework/Versions/Current/login".as_ptr(), RTLD_LAZY);
            if login.is_null() {
                return None;
            }
            dlsym(login, c"SACLockScreenImmediate".as_ptr())
        };
        (!call.is_null()).then(|| unsafe { std::mem::transmute::<*mut c_void, unsafe extern "C" fn()>(call) })
    }

    pub fn lock() {
        if locked() {
            return;
        }
        let Some(lock_now) = lock_now() else { return crate::log("lock: not available on this system") };
        unsafe { lock_now() };
        // the call only asks loginwindow – note it if the screen stays open
        std::thread::spawn(|| {
            for _ in 0..12 {
                std::thread::sleep(Duration::from_millis(250));
                if locked() {
                    return;
                }
            }
            crate::log("lock: the screen did not lock");
        });
    }

    #[cfg(test)]
    #[test]
    fn lock_call_exists() {
        assert!(lock_now().is_some());
    }

    /// Really locks this Mac's screen: `cargo test -p peekaview -- --ignored locks_the_screen`.
    #[cfg(test)]
    #[test]
    #[ignore]
    fn locks_the_screen() {
        assert!(!locked(), "unlock the screen first");
        lock();
        let locked_now = (0..12).any(|_| {
            std::thread::sleep(Duration::from_millis(250));
            locked()
        });
        assert!(locked_now);
    }
}

#[cfg(not(target_os = "macos"))]
mod imp {
    pub fn locked() -> bool {
        false
    }

    // nothing unlocks a screen here, so there is nothing to lock again
    pub fn lock() {}

    pub fn type_password(_: &str) -> Result<(), String> {
        Err("Entsperren aus der Ferne gibt es nur am Mac.".into())
    }
}
