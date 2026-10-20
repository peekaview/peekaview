//! Brings a shared window to the front when sharing starts (or switches to it).

#[cfg(target_os = "macos")]
mod imp {
    use std::ffi::c_void;

    use objc2_app_kit::{NSApplicationActivationOptions, NSRunningApplication};
    use objc2_core_foundation::CFString;

    type CFTypeRef = *const c_void;

    #[link(name = "ApplicationServices", kind = "framework")]
    extern "C" {
        fn AXIsProcessTrusted() -> bool;
        fn AXUIElementCreateApplication(pid: i32) -> CFTypeRef;
        fn AXUIElementCopyAttributeValue(element: CFTypeRef, attribute: CFTypeRef, value: *mut CFTypeRef) -> i32;
        fn AXUIElementPerformAction(element: CFTypeRef, action: CFTypeRef) -> i32;
        // widely used private API: CGWindowID of an AX window
        fn _AXUIElementGetWindow(element: CFTypeRef, id: *mut u32) -> i32;
    }

    #[link(name = "CoreFoundation", kind = "framework")]
    extern "C" {
        fn CFArrayGetCount(array: CFTypeRef) -> isize;
        fn CFArrayGetValueAtIndex(array: CFTypeRef, index: isize) -> CFTypeRef;
        fn CFRelease(value: CFTypeRef);
    }

    fn cf(s: &str) -> objc2_core_foundation::CFRetained<CFString> {
        CFString::from_str(s)
    }

    /// Raises exactly this window (needs the accessibility permission).
    unsafe fn raise(pid: i32, window_id: u32) {
        if !AXIsProcessTrusted() {
            return;
        }
        let app = AXUIElementCreateApplication(pid);
        if app.is_null() {
            return;
        }
        let mut windows: CFTypeRef = std::ptr::null();
        let attr = cf("AXWindows");
        if AXUIElementCopyAttributeValue(app, (&*attr as *const CFString).cast(), &mut windows) == 0 && !windows.is_null() {
            for i in 0..CFArrayGetCount(windows) {
                let window = CFArrayGetValueAtIndex(windows, i);
                let mut id = 0u32;
                if _AXUIElementGetWindow(window, &mut id) == 0 && id == window_id {
                    let action = cf("AXRaise");
                    AXUIElementPerformAction(window, (&*action as *const CFString).cast());
                    break;
                }
            }
            CFRelease(windows);
        }
        CFRelease(app);
    }

    pub fn bring_to_front(pid: u32, window_id: u32) {
        unsafe { raise(pid as i32, window_id) };
        if let Some(app) = NSRunningApplication::runningApplicationWithProcessIdentifier(pid as i32) {
            // allowed: PeekaView is the active app (the user just clicked its toolbar)
            app.activateWithOptions(NSApplicationActivationOptions(0));
        }
    }
}

#[cfg(target_os = "windows")]
mod imp {
    use windows_sys::Win32::UI::WindowsAndMessaging::{IsIconic, SetForegroundWindow, ShowWindow, SW_RESTORE};

    pub fn bring_to_front(_pid: u32, window_id: u32) {
        let hwnd = window_id as usize as windows_sys::Win32::Foundation::HWND;
        unsafe {
            if IsIconic(hwnd) != 0 {
                ShowWindow(hwnd, SW_RESTORE);
            }
            SetForegroundWindow(hwnd);
        }
    }
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
mod imp {
    pub fn bring_to_front(_pid: u32, _window_id: u32) {}
}

pub use imp::bring_to_front;
