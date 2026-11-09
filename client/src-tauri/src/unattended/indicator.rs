//! The bar on site while somebody is connected through the service: "Fernzugriff aktiv: <names>"
//! with a "Trennen" button – on the user's desktop, the sign-in screen and UAC prompts alike.
//!
//! A plain Win32 window (no WebView as SYSTEM) on a thread of its own. When the input desktop
//! changes, the window is destroyed, the thread moves to the new desktop and builds it again.

use std::sync::{
    atomic::{AtomicBool, Ordering},
    Mutex, Once,
};

use windows_sys::Win32::{
    Foundation::{HWND, LPARAM, LRESULT, RECT, WPARAM},
    Graphics::Gdi::{
        BeginPaint, CreateSolidBrush, DeleteObject, DrawTextW, EndPaint, FillRect, InvalidateRect, SetBkMode, SetTextColor, DT_CENTER, DT_END_ELLIPSIS,
        DT_LEFT, DT_SINGLELINE, DT_VCENTER, PAINTSTRUCT, TRANSPARENT,
    },
    System::LibraryLoader::GetModuleHandleW,
    UI::WindowsAndMessaging::{
        CreateWindowExW, DefWindowProcW, DestroyWindow, DispatchMessageW, GetClientRect, GetSystemMetrics, LoadCursorW, PeekMessageW, RegisterClassW,
        SetWindowPos, TranslateMessage, HWND_TOPMOST, IDC_ARROW, MSG, PM_REMOVE, SM_CXSCREEN, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, WM_LBUTTONUP,
        WM_PAINT, WNDCLASSW, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW, WS_EX_TOPMOST, WS_POPUP, WS_VISIBLE,
    },
};

use super::desk;

const WIDTH: i32 = 520;
const HEIGHT: i32 = 40;
const BUTTON: i32 = 110;

static TEXT: Mutex<String> = Mutex::new(String::new());
static NAMES: Mutex<Vec<String>> = Mutex::new(Vec::new());
static DISCONNECT: AtomicBool = AtomicBool::new(false);
static START: Once = Once::new();

fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

/// The viewers connected right now (empty: no bar).
pub fn set(names: Vec<String>) {
    START.call_once(|| {
        std::thread::spawn(run);
    });
    *NAMES.lock().unwrap() = names;
}

/// Was "Trennen" pressed since the last call?
pub fn take_disconnect() -> bool {
    DISCONNECT.swap(false, Ordering::SeqCst)
}

/// What the bar says.
pub fn text(names: &[String]) -> String {
    format!("Fernzugriff aktiv: {}", names.iter().map(|n| super::log::clean(n)).collect::<Vec<_>>().join(", "))
}

unsafe extern "system" fn proc(hwnd: HWND, msg: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    match msg {
        WM_PAINT => {
            let mut ps: PAINTSTRUCT = std::mem::zeroed();
            let dc = BeginPaint(hwnd, &mut ps);
            let mut rc: RECT = std::mem::zeroed();
            GetClientRect(hwnd, &mut rc);
            let red = CreateSolidBrush(0x001c1cb9); // #b91c1c (COLORREF is BGR)
            FillRect(dc, &rc, red);
            DeleteObject(red);
            let button = RECT { left: rc.right - BUTTON, top: rc.top + 6, right: rc.right - 8, bottom: rc.bottom - 6 };
            let white = CreateSolidBrush(0x00ffffff);
            FillRect(dc, &button, white);
            DeleteObject(white);
            SetBkMode(dc, TRANSPARENT as i32);
            SetTextColor(dc, 0x00ffffff);
            let mut label = RECT { left: rc.left + 14, top: rc.top, right: rc.right - BUTTON - 12, bottom: rc.bottom };
            let mut text: Vec<u16> = TEXT.lock().unwrap().encode_utf16().collect();
            DrawTextW(dc, text.as_mut_ptr(), text.len() as i32, &mut label, DT_LEFT | DT_VCENTER | DT_SINGLELINE | DT_END_ELLIPSIS);
            SetTextColor(dc, 0x001c1cb9);
            let mut b = button;
            let mut caption: Vec<u16> = "Trennen".encode_utf16().collect();
            DrawTextW(dc, caption.as_mut_ptr(), caption.len() as i32, &mut b, DT_CENTER | DT_VCENTER | DT_SINGLELINE);
            EndPaint(hwnd, &ps);
            0
        }
        WM_LBUTTONUP => {
            let x = (lparam & 0xffff) as i16 as i32;
            if x >= WIDTH - BUTTON {
                DISCONNECT.store(true, Ordering::SeqCst);
            }
            0
        }
        _ => DefWindowProcW(hwnd, msg, wparam, lparam),
    }
}

fn create(class: &[u16]) -> HWND {
    unsafe {
        let x = (GetSystemMetrics(SM_CXSCREEN) - WIDTH) / 2;
        let title = wide("PeekaView Fernzugriff");
        CreateWindowExW(
            WS_EX_TOPMOST | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE,
            class.as_ptr(),
            title.as_ptr(),
            WS_POPUP | WS_VISIBLE,
            x.max(0),
            0,
            WIDTH,
            HEIGHT,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            GetModuleHandleW(std::ptr::null()),
            std::ptr::null(),
        )
    }
}

fn run() {
    let class = wide("PeekaViewAccessBar");
    unsafe {
        let mut wc: WNDCLASSW = std::mem::zeroed();
        wc.lpfnWndProc = Some(proc);
        wc.hInstance = GetModuleHandleW(std::ptr::null());
        wc.lpszClassName = class.as_ptr();
        wc.hCursor = LoadCursorW(std::ptr::null_mut(), IDC_ARROW);
        RegisterClassW(&wc);
    }
    let mut hwnd: HWND = std::ptr::null_mut();
    let mut on: Option<String> = None;
    let mut shown = String::new();
    loop {
        let names = NAMES.lock().unwrap().clone();
        let input = desk::win::input_desktop();
        if !hwnd.is_null() && (names.is_empty() || input != on) {
            unsafe { DestroyWindow(hwnd) };
            hwnd = std::ptr::null_mut();
        }
        if hwnd.is_null() && !names.is_empty() {
            // no window on this thread now: it may move to the input desktop
            desk::win::follow_input_desktop();
            *TEXT.lock().unwrap() = text(&names);
            shown = TEXT.lock().unwrap().clone();
            hwnd = create(&class);
            on = input;
        }
        if !hwnd.is_null() {
            let now = text(&names);
            if now != shown {
                *TEXT.lock().unwrap() = now.clone();
                shown = now;
                unsafe { InvalidateRect(hwnd, std::ptr::null(), 1) };
            }
            // stays above the sign-in screen and other topmost windows
            unsafe { SetWindowPos(hwnd, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE) };
        }
        unsafe {
            let mut msg: MSG = std::mem::zeroed();
            while PeekMessageW(&mut msg, std::ptr::null_mut(), 0, 0, PM_REMOVE) != 0 {
                TranslateMessage(&msg);
                DispatchMessageW(&msg);
            }
        }
        std::thread::sleep(std::time::Duration::from_millis(100));
    }
}
