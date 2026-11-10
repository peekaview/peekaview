//! The bar on site while somebody is connected through the agent: "Fernzugriff aktiv: Anna" with
//! "Trennen" – at the top of the main screen, above everything (also at the login window and the
//! lock screen), on every Space. Plain AppKit (no WebView in the agent). Viewers do not see it:
//! ScreenCaptureKit leaves PeekaView's own windows out.

use std::{
    ffi::c_void,
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
};

use objc2::{define_class, msg_send, rc::Retained, runtime::{AnyClass, AnyObject, NSObject}, sel, AllocAnyThread};
use objc2_foundation::{NSPoint, NSRect, NSSize, NSString};
use tauri::AppHandle;

static DISCONNECT: AtomicBool = AtomicBool::new(false);
/// the names shown now (main thread only touches the window)
static SHOWN: Mutex<Option<Vec<String>>> = Mutex::new(None);

struct Bar {
    window: Retained<AnyObject>,
    label: Retained<AnyObject>,
    _target: Retained<Target>,
}

// only used on the main thread
unsafe impl Send for Bar {}

static BAR: Mutex<Option<Bar>> = Mutex::new(None);

define_class!(
    #[unsafe(super(NSObject))]
    #[name = "PeekaViewDisconnectTarget"]
    struct Target;

    impl Target {
        #[unsafe(method(disconnect:))]
        fn disconnect(&self, _sender: *mut AnyObject) {
            DISCONNECT.store(true, Ordering::SeqCst);
        }
    }
);

#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    fn CGShieldingWindowLevel() -> i32;
}

const WIDTH: f64 = 440.0;
const HEIGHT: f64 = 34.0;

fn class(name: &std::ffi::CStr) -> &'static AnyClass {
    AnyClass::get(name).expect("AppKit class")
}

/// "Anna, Ben" → the bar's text.
pub fn text(names: &[String]) -> String {
    let names: Vec<String> = names.iter().map(|n| super::super::log::clean(n)).collect();
    format!("Fernzugriff aktiv: {}", names.join(", "))
}

unsafe fn create() -> Bar {
    let screen: *mut AnyObject = msg_send![class(c"NSScreen"), mainScreen];
    let frame: NSRect = if screen.is_null() { NSRect::new(NSPoint::new(0.0, 0.0), NSSize::new(1280.0, 800.0)) } else { msg_send![screen, frame] };
    let rect = NSRect::new(
        NSPoint::new(frame.origin.x + (frame.size.width - WIDTH) / 2.0, frame.origin.y + frame.size.height - HEIGHT - 40.0),
        NSSize::new(WIDTH, HEIGHT),
    );
    // borderless (0) | non-activating panel (1 << 7)
    let window: *mut AnyObject = msg_send![class(c"NSPanel"), alloc];
    let window: *mut AnyObject = msg_send![window, initWithContentRect: rect, styleMask: (1usize << 7), backing: 2usize, defer: false];
    let window = Retained::retain(window).expect("NSPanel");
    let red: *mut AnyObject = msg_send![class(c"NSColor"), colorWithSRGBRed: 0.86f64, green: 0.15f64, blue: 0.15f64, alpha: 0.95f64];
    let _: () = msg_send![&*window, setBackgroundColor: red];
    let _: () = msg_send![&*window, setOpaque: false];
    let _: () = msg_send![&*window, setHasShadow: true];
    let _: () = msg_send![&*window, setLevel: (CGShieldingWindowLevel() as isize)];
    // all Spaces | stationary | full-screen auxiliary | ignores cycle
    let _: () = msg_send![&*window, setCollectionBehavior: ((1usize << 0) | (1 << 4) | (1 << 8) | (1 << 6))];
    let _: () = msg_send![&*window, setCanBecomeVisibleWithoutLogin: true];
    let _: () = msg_send![&*window, setHidesOnDeactivate: false];
    let _: () = msg_send![&*window, setReleasedWhenClosed: false];

    let content: *mut AnyObject = msg_send![&*window, contentView];
    let label: *mut AnyObject = msg_send![class(c"NSTextField"), labelWithString: &*NSString::from_str("")];
    let label = Retained::retain(label).expect("label");
    let white: *mut AnyObject = msg_send![class(c"NSColor"), whiteColor];
    let _: () = msg_send![&*label, setTextColor: white];
    let font: *mut AnyObject = msg_send![class(c"NSFont"), boldSystemFontOfSize: 13.0f64];
    let _: () = msg_send![&*label, setFont: font];
    let _: () = msg_send![&*label, setFrame: NSRect::new(NSPoint::new(14.0, 8.0), NSSize::new(WIDTH - 120.0, 18.0))];
    let _: () = msg_send![&*label, setLineBreakMode: 4usize /* truncate tail */];
    let _: () = msg_send![content, addSubview: &*label];

    let target: Retained<Target> = msg_send![Target::alloc(), init];
    let button: *mut AnyObject = msg_send![class(c"NSButton"), buttonWithTitle: &*NSString::from_str("Trennen"), target: &*target, action: sel!(disconnect:)];
    let _: () = msg_send![button, setFrame: NSRect::new(NSPoint::new(WIDTH - 98.0, 4.0), NSSize::new(88.0, 26.0))];
    let _: () = msg_send![content, addSubview: button];
    Bar { window, label, _target: target }
}

/// Shows the bar with these names, or hides it (empty). Any thread.
pub fn set(app: &AppHandle, names: Vec<String>) {
    {
        let mut shown = SHOWN.lock().unwrap();
        if shown.as_ref() == Some(&names) {
            return;
        }
        *shown = Some(names.clone());
    }
    let _ = app.run_on_main_thread(move || unsafe {
        let mut bar = BAR.lock().unwrap();
        if names.is_empty() {
            if let Some(b) = bar.as_ref() {
                let _: () = msg_send![&*b.window, orderOut: std::ptr::null::<c_void>()];
            }
            return;
        }
        let b = bar.get_or_insert_with(|| create());
        let _: () = msg_send![&*b.label, setStringValue: &*NSString::from_str(&text(&names))];
        let _: () = msg_send![&*b.window, orderFrontRegardless];
    });
}

/// "Trennen" was clicked (since the last call).
pub fn take_disconnect() -> bool {
    DISCONNECT.swap(false, Ordering::SeqCst)
}
