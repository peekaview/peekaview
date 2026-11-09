//! The Mac's console: is someone signed in, is the screen locked, does this process's session
//! own the screen right now (fast user switching)?

use super::cf::{dict_bool, Owned};

#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    fn CGSessionCopyCurrentDictionary() -> super::cf::CFTypeRef;
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Console {
    /// the session of this process went through sign-in (false: the login window)
    pub signed_in: bool,
    pub locked: bool,
    /// the session is the one on the screen
    pub on_console: bool,
}

pub fn current() -> Console {
    // no window server session (a daemon): nothing on screen
    let Some(dict) = Owned::new(unsafe { CGSessionCopyCurrentDictionary() }) else {
        return Console::default();
    };
    unsafe {
        Console {
            signed_in: dict_bool(dict.0, c"kCGSessionLoginDoneKey"),
            locked: dict_bool(dict.0, c"CGSSessionScreenIsLocked"),
            on_console: dict_bool(dict.0, c"kCGSessionOnConsoleKey"),
        }
    }
}

/// Is this process root (an agent in the login window session runs as root)?
pub fn root() -> bool {
    unsafe { libc::geteuid() == 0 }
}
