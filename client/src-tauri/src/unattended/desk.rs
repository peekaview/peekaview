//! What the console currently shows: the user's desktop, the sign-in screen, the lock screen or a
//! secure-desktop prompt (UAC). Viewers see it as a hint; the helper follows the input desktop.

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Desk {
    Normal,
    /// nobody signed in: the sign-in screen
    Login,
    /// signed in, but locked
    Locked,
    /// the secure desktop while signed in and unlocked: a UAC prompt (or Strg+Alt+Entf screen)
    Secure,
}

impl Desk {
    pub fn as_str(self) -> &'static str {
        match self {
            Desk::Normal => "normal",
            Desk::Login => "login",
            Desk::Locked => "locked",
            Desk::Secure => "secure",
        }
    }
}

/// `input_desktop`: name of the desktop receiving input ("Default", "Winlogon", "Screen-saver").
pub fn classify(input_desktop: &str, signed_in: bool, locked: bool) -> Desk {
    if !signed_in {
        Desk::Login
    } else if locked {
        Desk::Locked
    } else if input_desktop.eq_ignore_ascii_case("winlogon") {
        Desk::Secure
    } else {
        Desk::Normal
    }
}

/// Windows: the input desktop and the console session's state, and switching threads over.
#[cfg(target_os = "windows")]
pub mod win {
    use std::cell::RefCell;

    use windows_sys::Win32::{
        Foundation::{GENERIC_ALL, HANDLE},
        System::{
            RemoteDesktop::{
                WTSFreeMemory, WTSQuerySessionInformationW, WTSSessionInfoEx, WTSINFOEXW, WTS_CURRENT_SERVER_HANDLE, WTS_CURRENT_SESSION,
            },
            StationsAndDesktops::{CloseDesktop, GetUserObjectInformationW, OpenInputDesktop, SetThreadDesktop, HDESK, UOI_NAME},
        },
    };

    use super::{classify, Desk};

    const WTS_SESSIONSTATE_LOCK: i32 = 0;

    fn name_of(desk: HDESK) -> Option<String> {
        let mut buf = [0u16; 128];
        let mut needed = 0u32;
        let ok = unsafe { GetUserObjectInformationW(desk as HANDLE, UOI_NAME, buf.as_mut_ptr().cast(), (buf.len() * 2) as u32, &mut needed) };
        if ok == 0 {
            return None;
        }
        let len = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
        Some(String::from_utf16_lossy(&buf[..len]))
    }

    /// Name of the desktop that currently receives input.
    pub fn input_desktop() -> Option<String> {
        let desk = unsafe { OpenInputDesktop(0, 0, 0x0001 /* DESKTOP_READOBJECTS */) };
        if desk.is_null() {
            return None;
        }
        let name = name_of(desk);
        unsafe { CloseDesktop(desk) };
        name
    }

    /// (someone signed in, locked) for this process's session.
    pub fn session_state() -> (bool, bool) {
        let mut buf: *mut u16 = std::ptr::null_mut();
        let mut bytes = 0u32;
        let ok = unsafe { WTSQuerySessionInformationW(WTS_CURRENT_SERVER_HANDLE, WTS_CURRENT_SESSION, WTSSessionInfoEx, &mut buf, &mut bytes) };
        if ok == 0 || buf.is_null() || (bytes as usize) < std::mem::size_of::<WTSINFOEXW>() {
            return (true, false);
        }
        let (signed_in, locked) = unsafe {
            let info = &*(buf as *const WTSINFOEXW);
            let l1 = &info.Data.WTSInfoExLevel1;
            (l1.UserName[0] != 0, l1.SessionFlags == WTS_SESSIONSTATE_LOCK)
        };
        unsafe { WTSFreeMemory(buf.cast()) };
        (signed_in, locked)
    }

    pub fn current() -> Desk {
        let (signed_in, locked) = session_state();
        classify(&input_desktop().unwrap_or_default(), signed_in, locked)
    }

    thread_local! {
        /// the desktop this thread was moved to (handle kept open while the thread uses it)
        static ATTACHED: RefCell<Option<(HDESK, String)>> = const { RefCell::new(None) };
    }

    /// Moves the calling thread to the input desktop if that changed (Default ↔ Winlogon). The
    /// thread must not own windows. Returns true when it switched – capture must start afresh.
    pub fn follow_input_desktop() -> bool {
        let desk = unsafe { OpenInputDesktop(0, 0, GENERIC_ALL) };
        if desk.is_null() {
            return false;
        }
        let Some(name) = name_of(desk) else {
            unsafe { CloseDesktop(desk) };
            return false;
        };
        ATTACHED.with(|a| {
            let mut a = a.borrow_mut();
            if a.as_ref().is_some_and(|(_, n)| *n == name) {
                unsafe { CloseDesktop(desk) };
                return false;
            }
            if unsafe { SetThreadDesktop(desk) } == 0 {
                unsafe { CloseDesktop(desk) };
                return false;
            }
            if let Some((old, _)) = a.replace((desk, name)) {
                unsafe { CloseDesktop(old) };
            }
            true
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifies_console_states() {
        assert_eq!(classify("Default", true, false), Desk::Normal);
        assert_eq!(classify("Winlogon", false, false), Desk::Login);
        assert_eq!(classify("Default", false, false), Desk::Login, "sign-in screen, whatever the desktop");
        assert_eq!(classify("Winlogon", true, true), Desk::Locked);
        assert_eq!(classify("Default", true, true), Desk::Locked, "lock screen before the password field");
        assert_eq!(classify("winlogon", true, false), Desk::Secure, "UAC prompt");
        assert_eq!(classify("Screen-saver", true, false), Desk::Normal);
        assert_eq!(Desk::Secure.as_str(), "secure");
    }
}
