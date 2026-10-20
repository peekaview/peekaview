//! Presenter input state for the session recording – polled, no event tap, no extra permission.

#[cfg(target_os = "macos")]
mod imp {
    // kCGEventSourceStateCombinedSessionState
    const COMBINED: i32 = 0;
    const KEY_DOWN: u32 = 10;
    const RETURN: u16 = 36;
    const KEYPAD_ENTER: u16 = 76;

    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        fn CGEventSourceButtonState(state: i32, button: u32) -> bool;
        fn CGEventSourceKeyState(state: i32, key: u16) -> bool;
        fn CGEventSourceSecondsSinceLastEventType(state: i32, event_type: u32) -> f64;
    }

    pub fn left_button() -> bool {
        unsafe { CGEventSourceButtonState(COMBINED, 0) }
    }

    pub fn enter_key() -> bool {
        unsafe { CGEventSourceKeyState(COMBINED, RETURN) || CGEventSourceKeyState(COMBINED, KEYPAD_ENTER) }
    }

    pub fn secs_since_key() -> Option<f64> {
        Some(unsafe { CGEventSourceSecondsSinceLastEventType(COMBINED, KEY_DOWN) })
    }
}

#[cfg(target_os = "windows")]
mod imp {
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::GetAsyncKeyState;

    pub fn left_button() -> bool {
        unsafe { GetAsyncKeyState(0x01) as u16 & 0x8000 != 0 }
    }

    pub fn enter_key() -> bool {
        unsafe { GetAsyncKeyState(0x0D) as u16 & 0x8000 != 0 }
    }

    pub fn secs_since_key() -> Option<f64> {
        None
    }
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
mod imp {
    pub fn left_button() -> bool {
        false
    }

    pub fn enter_key() -> bool {
        false
    }

    pub fn secs_since_key() -> Option<f64> {
        None
    }
}

pub use imp::*;
