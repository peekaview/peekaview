//! Brings a shared window to the front when sharing starts (or switches to it), and gives it
//! a new frame ("best size for the viewers").

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
        fn AXUIElementSetAttributeValue(element: CFTypeRef, attribute: CFTypeRef, value: CFTypeRef) -> i32;
        fn AXValueCreate(kind: u32, value: *const c_void) -> CFTypeRef;
        // widely used private API: CGWindowID of an AX window
        fn _AXUIElementGetWindow(element: CFTypeRef, id: *mut u32) -> i32;
    }

    #[link(name = "CoreFoundation", kind = "framework")]
    extern "C" {
        fn CFArrayGetCount(array: CFTypeRef) -> isize;
        fn CFArrayGetValueAtIndex(array: CFTypeRef, index: isize) -> CFTypeRef;
        fn CFRelease(value: CFTypeRef);
        static kCFBooleanTrue: CFTypeRef;
    }

    fn cf(s: &str) -> objc2_core_foundation::CFRetained<CFString> {
        CFString::from_str(s)
    }

    /// Runs `f` on the AX element of exactly this window (needs the accessibility permission).
    unsafe fn with_window(pid: i32, window_id: u32, f: impl FnOnce(CFTypeRef)) -> bool {
        if !AXIsProcessTrusted() {
            return false;
        }
        let mut found = false;
        let app = AXUIElementCreateApplication(pid);
        if app.is_null() {
            return false;
        }
        let mut windows: CFTypeRef = std::ptr::null();
        let attr = cf("AXWindows");
        if AXUIElementCopyAttributeValue(app, (&*attr as *const CFString).cast(), &mut windows) == 0 && !windows.is_null() {
            for i in 0..CFArrayGetCount(windows) {
                let window = CFArrayGetValueAtIndex(windows, i);
                let mut id = 0u32;
                if _AXUIElementGetWindow(window, &mut id) == 0 && id == window_id {
                    f(window);
                    found = true;
                    break;
                }
            }
            CFRelease(windows);
        }
        CFRelease(app);
        found
    }

    /// Raises exactly this window and makes its app the frontmost one – through the accessibility
    /// API, which (unlike activating an app) also works when PeekaView is not the active app
    /// itself, e.g. for the second of several shared windows.
    unsafe fn raise(pid: i32, window_id: u32) -> bool {
        let raised = with_window(pid, window_id, |window| {
            let main = cf("AXMain");
            AXUIElementSetAttributeValue(window, (&*main as *const CFString).cast(), kCFBooleanTrue);
            let action = cf("AXRaise");
            AXUIElementPerformAction(window, (&*action as *const CFString).cast());
        });
        if raised {
            let app = AXUIElementCreateApplication(pid);
            if !app.is_null() {
                let front = cf("AXFrontmost");
                AXUIElementSetAttributeValue(app, (&*front as *const CFString).cast(), kCFBooleanTrue);
                CFRelease(app);
            }
        }
        raised
    }

    /// Presses only the close button of the specified window, without quitting its app.
    pub fn close_window(pid: i32, window_id: u32) -> bool {
        let mut closed = false;
        unsafe {
            with_window(pid, window_id, |window| {
                let attr = cf("AXCloseButton");
                let mut button = std::ptr::null();
                if AXUIElementCopyAttributeValue(window, (&*attr as *const CFString).cast(), &mut button) == 0 && !button.is_null() {
                    let press = cf("AXPress");
                    closed = AXUIElementPerformAction(button, (&*press as *const CFString).cast()) == 0;
                    CFRelease(button);
                }
            });
        }
        closed
    }

    /// Moves / resizes a window (screen points, top-left origin).
    pub fn set_frame(pid: u32, window_id: u32, x: f64, y: f64, w: f64, h: f64) -> bool {
        #[repr(C)]
        struct Pair(f64, f64);
        const POINT: u32 = 1;
        const SIZE: u32 = 2;
        unsafe {
            with_window(pid as i32, window_id, |window| {
                for (attr, kind, value) in [("AXPosition", POINT, Pair(x, y)), ("AXSize", SIZE, Pair(w, h)), ("AXPosition", POINT, Pair(x, y))] {
                    let v = AXValueCreate(kind, (&value as *const Pair).cast());
                    if !v.is_null() {
                        let attr = cf(attr);
                        AXUIElementSetAttributeValue(window, (&*attr as *const CFString).cast(), v);
                        CFRelease(v);
                    }
                }
            })
        }
    }

    pub fn bring_to_front(pid: u32, window_id: u32) {
        if unsafe { raise(pid as i32, window_id) } {
            return;
        }
        // without the accessibility permission: activate the app (allowed while PeekaView is the
        // active app, i.e. right after the user clicked its window)
        if let Some(app) = NSRunningApplication::runningApplicationWithProcessIdentifier(pid as i32) {
            app.activateWithOptions(NSApplicationActivationOptions(0));
        }
    }
}

#[cfg(target_os = "windows")]
mod imp {
    use windows_sys::Win32::UI::WindowsAndMessaging::{IsIconic, SetForegroundWindow, SetWindowPos, ShowWindow, SWP_NOACTIVATE, SWP_NOZORDER, SW_RESTORE};

    /// Moves / resizes a window (physical pixels).
    pub fn set_frame(_pid: u32, window_id: u32, x: f64, y: f64, w: f64, h: f64) -> bool {
        let hwnd = window_id as usize as windows_sys::Win32::Foundation::HWND;
        unsafe { SetWindowPos(hwnd, std::ptr::null_mut(), x as i32, y as i32, w as i32, h as i32, SWP_NOZORDER | SWP_NOACTIVATE) != 0 }
    }

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

    pub fn set_frame(_pid: u32, _window_id: u32, _x: f64, _y: f64, _w: f64, _h: f64) -> bool {
        false
    }
}

pub use imp::{bring_to_front, set_frame};
#[cfg(target_os = "macos")]
pub use imp::close_window;
