//! The few CoreFoundation calls the macOS parts need (raw, without a wrapper crate).

#![allow(non_upper_case_globals)]

use std::ffi::{c_char, c_void, CStr};

pub type CFTypeRef = *const c_void;

const UTF8: u32 = 0x0800_0100;

#[link(name = "CoreFoundation", kind = "framework")]
extern "C" {
    pub static kCFBooleanTrue: CFTypeRef;
    pub static kCFTypeDictionaryKeyCallBacks: u8;
    pub static kCFTypeDictionaryValueCallBacks: u8;
    pub fn CFRelease(cf: CFTypeRef);
    fn CFStringCreateWithCString(alloc: CFTypeRef, s: *const c_char, encoding: u32) -> CFTypeRef;
    fn CFDictionaryGetValue(dict: CFTypeRef, key: CFTypeRef) -> CFTypeRef;
    pub fn CFDictionaryCreate(
        alloc: CFTypeRef,
        keys: *const CFTypeRef,
        values: *const CFTypeRef,
        count: isize,
        key_callbacks: *const u8,
        value_callbacks: *const u8,
    ) -> CFTypeRef;
    pub fn CFDataCreate(alloc: CFTypeRef, bytes: *const u8, len: isize) -> CFTypeRef;
    fn CFEqual(a: CFTypeRef, b: CFTypeRef) -> bool;
}

/// An owned CF object, released on drop.
pub struct Owned(pub CFTypeRef);

impl Owned {
    pub fn new(p: CFTypeRef) -> Option<Owned> {
        (!p.is_null()).then_some(Owned(p))
    }
}

impl Drop for Owned {
    fn drop(&mut self) {
        unsafe { CFRelease(self.0) };
    }
}

pub fn string(s: &CStr) -> Owned {
    Owned(unsafe { CFStringCreateWithCString(std::ptr::null(), s.as_ptr(), UTF8) })
}

/// `dict[key] == kCFBooleanTrue` (a missing key is false).
///
/// # Safety
/// `dict` must be a CFDictionary.
pub unsafe fn dict_bool(dict: CFTypeRef, key: &CStr) -> bool {
    let key = string(key);
    let v = CFDictionaryGetValue(dict, key.0);
    !v.is_null() && CFEqual(v, kCFBooleanTrue)
}
