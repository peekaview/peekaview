//! CGDisplayStream capture of a whole display – the fallback where ScreenCaptureKit delivers
//! nothing: the macOS agent at the login window (before macOS 14.4, and on some 15.x systems).
//! Frames (IOSurfaces, 4:2:0) go to the same VideoToolbox encoder as ScreenCaptureKit's.
//! `PEEKAVIEW_CGSTREAM=1` picks it for screens in the normal app as well (for testing).

use std::{
    ffi::{c_char, c_void},
    sync::{Arc, Mutex},
};

use block2::RcBlock;

use super::mac::EncState;

type CFTypeRef = *const c_void;

/// kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange ('420v'), as ScreenCaptureKit delivers
const FORMAT_420V: i32 = i32::from_be_bytes(*b"420v");
const FRAME_COMPLETE: i32 = 0;
const CF_NUMBER_DOUBLE: isize = 13;

#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    static kCGDisplayStreamShowCursor: CFTypeRef;
    static kCGDisplayStreamMinimumFrameTime: CFTypeRef;
    fn CGDisplayStreamCreateWithDispatchQueue(
        display: u32,
        width: usize,
        height: usize,
        format: i32,
        properties: CFTypeRef,
        queue: *mut c_void,
        handler: &block2::Block<dyn Fn(i32, u64, CFTypeRef, CFTypeRef)>,
    ) -> CFTypeRef;
    fn CGDisplayStreamStart(stream: CFTypeRef) -> i32;
    fn CGDisplayStreamStop(stream: CFTypeRef) -> i32;
}

#[link(name = "CoreFoundation", kind = "framework")]
extern "C" {
    static kCFBooleanFalse: CFTypeRef;
    static kCFTypeDictionaryKeyCallBacks: u8;
    static kCFTypeDictionaryValueCallBacks: u8;
    fn CFDictionaryCreate(a: CFTypeRef, k: *const CFTypeRef, v: *const CFTypeRef, n: isize, kcb: *const u8, vcb: *const u8) -> CFTypeRef;
    fn CFNumberCreate(a: CFTypeRef, kind: isize, value: *const c_void) -> CFTypeRef;
    fn CFRelease(x: CFTypeRef);
}

#[link(name = "CoreVideo", kind = "framework")]
extern "C" {
    fn CVPixelBufferCreateWithIOSurface(a: CFTypeRef, surface: CFTypeRef, attrs: CFTypeRef, out: *mut CFTypeRef) -> i32;
}

extern "C" {
    fn dispatch_queue_create(label: *const c_char, attr: *const c_void) -> *mut c_void;
    fn dispatch_release(object: *mut c_void);
}

pub struct CgStream {
    stream: CFTypeRef,
    queue: *mut c_void,
    _handler: RcBlock<dyn Fn(i32, u64, CFTypeRef, CFTypeRef)>,
}

unsafe impl Send for CgStream {}

impl CgStream {
    /// Captures `display` scaled to `size`, feeding `state`.
    pub fn start(display: u32, size: (u32, u32), state: Arc<Mutex<EncState>>) -> Result<CgStream, String> {
        let handler = RcBlock::new(move |status: i32, _time: u64, surface: CFTypeRef, _update: CFTypeRef| {
            if status != FRAME_COMPLETE || surface.is_null() {
                return;
            }
            let mut pb: CFTypeRef = std::ptr::null();
            if unsafe { CVPixelBufferCreateWithIOSurface(std::ptr::null(), surface, std::ptr::null(), &mut pb) } != 0 || pb.is_null() {
                return;
            }
            state.lock().unwrap().frame(pb);
            unsafe { CFRelease(pb) };
        });
        unsafe {
            let fps = 1.0f64 / super::FPS as f64;
            let min_time = CFNumberCreate(std::ptr::null(), CF_NUMBER_DOUBLE, (&fps as *const f64).cast());
            let keys = [kCGDisplayStreamShowCursor, kCGDisplayStreamMinimumFrameTime];
            let values = [kCFBooleanFalse, min_time];
            let props = CFDictionaryCreate(std::ptr::null(), keys.as_ptr(), values.as_ptr(), 2, &kCFTypeDictionaryKeyCallBacks, &kCFTypeDictionaryValueCallBacks);
            CFRelease(min_time);
            let queue = dispatch_queue_create(c"de.limtec.peekaview.cgstream".as_ptr(), std::ptr::null());
            let stream = CGDisplayStreamCreateWithDispatchQueue(display, size.0 as usize, size.1 as usize, FORMAT_420V, props, queue, &handler);
            CFRelease(props);
            if stream.is_null() {
                dispatch_release(queue);
                return Err("Bildschirmaufnahme nicht möglich (CGDisplayStream).".into());
            }
            if CGDisplayStreamStart(stream) != 0 {
                CFRelease(stream);
                dispatch_release(queue);
                return Err("Bildschirmaufnahme nicht möglich (CGDisplayStream startet nicht).".into());
            }
            Ok(CgStream { stream, queue, _handler: handler })
        }
    }
}

impl Drop for CgStream {
    fn drop(&mut self) {
        unsafe {
            CGDisplayStreamStop(self.stream);
            CFRelease(self.stream);
            dispatch_release(self.queue);
        }
    }
}
