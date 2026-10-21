//! Hardware H.264 encoder via VideoToolbox (plain C API).
//!
//! Takes the IOSurface-backed CVPixelBuffers delivered by ScreenCaptureKit directly – the frame
//! never touches the CPU. Output is converted from AVCC to Annex B (what WebCodecs expects when
//! no `description` is configured), SPS/PPS are prepended to every keyframe.

#![allow(non_upper_case_globals, non_snake_case)]

use std::{
    ffi::c_void,
    ptr,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::Instant,
};

type CFTypeRef = *const c_void;
type OSStatus = i32;

#[repr(C)]
#[derive(Clone, Copy)]
struct CMTime {
    value: i64,
    timescale: i32,
    flags: u32,
    epoch: i64,
}

const CM_TIME_INVALID: CMTime = CMTime { value: 0, timescale: 0, flags: 0, epoch: 0 };
const CODEC_H264: u32 = u32::from_be_bytes(*b"avc1");
const FRAME_DROPPED: u32 = 1 << 1;
const CF_NUMBER_SINT32: isize = 3;
const CF_NUMBER_DOUBLE: isize = 13;

type OutputCallback = extern "C" fn(*mut c_void, *mut c_void, OSStatus, u32, CFTypeRef);

#[link(name = "CoreFoundation", kind = "framework")]
extern "C" {
    static kCFBooleanTrue: CFTypeRef;
    static kCFBooleanFalse: CFTypeRef;
    static kCFTypeDictionaryKeyCallBacks: u8;
    static kCFTypeDictionaryValueCallBacks: u8;
    static kCFTypeArrayCallBacks: u8;
    fn CFDictionaryCreate(a: CFTypeRef, k: *const CFTypeRef, v: *const CFTypeRef, n: isize, kcb: *const u8, vcb: *const u8) -> CFTypeRef;
    fn CFDictionaryGetValue(d: CFTypeRef, key: CFTypeRef) -> CFTypeRef;
    fn CFArrayCreate(a: CFTypeRef, v: *const CFTypeRef, n: isize, cb: *const u8) -> CFTypeRef;
    fn CFArrayGetCount(a: CFTypeRef) -> isize;
    fn CFArrayGetValueAtIndex(a: CFTypeRef, i: isize) -> CFTypeRef;
    fn CFNumberCreate(a: CFTypeRef, kind: isize, value: *const c_void) -> CFTypeRef;
    fn CFRetain(x: CFTypeRef) -> CFTypeRef;
    fn CFRelease(x: CFTypeRef);
}

#[link(name = "CoreMedia", kind = "framework")]
extern "C" {
    static kCMSampleAttachmentKey_NotSync: CFTypeRef;
    fn CMSampleBufferGetDataBuffer(sb: CFTypeRef) -> CFTypeRef;
    fn CMSampleBufferGetFormatDescription(sb: CFTypeRef) -> CFTypeRef;
    fn CMSampleBufferGetSampleAttachmentsArray(sb: CFTypeRef, create: u8) -> CFTypeRef;
    fn CMBlockBufferGetDataLength(bb: CFTypeRef) -> usize;
    fn CMBlockBufferCopyDataBytes(bb: CFTypeRef, offset: usize, len: usize, dest: *mut c_void) -> OSStatus;
    fn CMVideoFormatDescriptionGetH264ParameterSetAtIndex(
        desc: CFTypeRef,
        index: usize,
        ptr_out: *mut *const u8,
        size_out: *mut usize,
        count_out: *mut usize,
        nal_header_len_out: *mut i32,
    ) -> OSStatus;
}

#[link(name = "CoreVideo", kind = "framework")]
extern "C" {
    fn CVPixelBufferGetWidth(pb: CFTypeRef) -> usize;
    fn CVPixelBufferGetHeight(pb: CFTypeRef) -> usize;
    fn CVPixelBufferLockBaseAddress(pb: CFTypeRef, flags: u64) -> i32;
    fn CVPixelBufferUnlockBaseAddress(pb: CFTypeRef, flags: u64) -> i32;
    fn CVPixelBufferGetBaseAddressOfPlane(pb: CFTypeRef, plane: usize) -> *const c_void;
    fn CVPixelBufferGetBytesPerRowOfPlane(pb: CFTypeRef, plane: usize) -> usize;
    fn CVPixelBufferGetWidthOfPlane(pb: CFTypeRef, plane: usize) -> usize;
    fn CVPixelBufferGetHeightOfPlane(pb: CFTypeRef, plane: usize) -> usize;
}

#[link(name = "VideoToolbox", kind = "framework")]
extern "C" {
    static kVTVideoEncoderSpecification_EnableHardwareAcceleratedVideoEncoder: CFTypeRef;
    // macOS 11.3+: rate control made for video calls / screen sharing (low latency)
    static kVTVideoEncoderSpecification_EnableLowLatencyRateControl: CFTypeRef;
    static kVTCompressionPropertyKey_RealTime: CFTypeRef;
    static kVTCompressionPropertyKey_ProfileLevel: CFTypeRef;
    static kVTCompressionPropertyKey_AllowFrameReordering: CFTypeRef;
    static kVTCompressionPropertyKey_MaxKeyFrameInterval: CFTypeRef;
    static kVTCompressionPropertyKey_AverageBitRate: CFTypeRef;
    static kVTCompressionPropertyKey_DataRateLimits: CFTypeRef;
    static kVTCompressionPropertyKey_ExpectedFrameRate: CFTypeRef;
    static kVTProfileLevel_H264_ConstrainedBaseline_AutoLevel: CFTypeRef;
    static kVTEncodeFrameOptionKey_ForceKeyFrame: CFTypeRef;
    fn VTCompressionSessionCreate(
        a: CFTypeRef,
        w: i32,
        h: i32,
        codec: u32,
        spec: CFTypeRef,
        src_attrs: CFTypeRef,
        data_alloc: CFTypeRef,
        cb: OutputCallback,
        refcon: *mut c_void,
        out: *mut CFTypeRef,
    ) -> OSStatus;
    fn VTSessionSetProperty(s: CFTypeRef, key: CFTypeRef, value: CFTypeRef) -> OSStatus;
    fn VTCompressionSessionPrepareToEncodeFrames(s: CFTypeRef) -> OSStatus;
    fn VTCompressionSessionEncodeFrame(
        s: CFTypeRef,
        image: CFTypeRef,
        pts: CMTime,
        dur: CMTime,
        props: CFTypeRef,
        src_refcon: *mut c_void,
        flags_out: *mut u32,
    ) -> OSStatus;
    fn VTCompressionSessionCompleteFrames(s: CFTypeRef, until: CMTime) -> OSStatus;
    fn VTCompressionSessionInvalidate(s: CFTypeRef);
}

/// Receives (annex_b, is_keyframe).
pub type Sink = Box<dyn Fn(Vec<u8>, bool) + Send + Sync>;

struct Ctx {
    sink: Sink,
    /// set when the encoder dropped a frame – the next one must be a keyframe
    broken: Arc<AtomicBool>,
}

pub struct VtEncoder {
    pub bitrate: u32,
    session: CFTypeRef,
    ctx: *mut Ctx,
    force_key_props: CFTypeRef,
    pub width: usize,
    pub height: usize,
    started: Instant,
    broken: Arc<AtomicBool>,
}

// The session is only driven from behind a Mutex; VideoToolbox itself is thread safe.
unsafe impl Send for VtEncoder {}

unsafe fn number_i32(v: i32) -> CFTypeRef {
    CFNumberCreate(ptr::null(), CF_NUMBER_SINT32, &v as *const i32 as *const c_void)
}

unsafe fn number_f64(v: f64) -> CFTypeRef {
    CFNumberCreate(ptr::null(), CF_NUMBER_DOUBLE, &v as *const f64 as *const c_void)
}

unsafe fn dict(keys: &[CFTypeRef], values: &[CFTypeRef]) -> CFTypeRef {
    CFDictionaryCreate(
        ptr::null(),
        keys.as_ptr(),
        values.as_ptr(),
        keys.len() as isize,
        &kCFTypeDictionaryKeyCallBacks,
        &kCFTypeDictionaryValueCallBacks,
    )
}

unsafe fn set_owned(session: CFTypeRef, key: CFTypeRef, value: CFTypeRef) {
    VTSessionSetProperty(session, key, value);
    CFRelease(value);
}

/// Average bitrate; bursts (e.g. scrolling) may use 1.5× that within a second.
unsafe fn apply_bitrate(session: CFTypeRef, bitrate: u32) {
    set_owned(session, kVTCompressionPropertyKey_AverageBitRate, number_i32(bitrate as i32));
    let limits = [number_f64(bitrate as f64 * 1.5 / 8.0), number_f64(1.0)];
    let array = CFArrayCreate(ptr::null(), limits.as_ptr(), 2, &kCFTypeArrayCallBacks);
    limits.iter().for_each(|v| CFRelease(*v));
    set_owned(session, kVTCompressionPropertyKey_DataRateLimits, array);
}

impl VtEncoder {
    pub fn new(width: usize, height: usize, fps: u32, bitrate: u32, sink: Sink) -> Option<Self> {
        let broken = Arc::new(AtomicBool::new(false));
        let ctx = Box::into_raw(Box::new(Ctx { sink, broken: broken.clone() }));
        unsafe {
            // low-latency rate control first, the normal hardware encoder as fallback
            let mut session: CFTypeRef = ptr::null();
            for low_latency in [true, false] {
                let spec = if low_latency {
                    dict(&[kVTVideoEncoderSpecification_EnableHardwareAcceleratedVideoEncoder, kVTVideoEncoderSpecification_EnableLowLatencyRateControl], &[kCFBooleanTrue, kCFBooleanTrue])
                } else {
                    dict(&[kVTVideoEncoderSpecification_EnableHardwareAcceleratedVideoEncoder], &[kCFBooleanTrue])
                };
                let status = VTCompressionSessionCreate(
                    ptr::null(),
                    width as i32,
                    height as i32,
                    CODEC_H264,
                    spec,
                    ptr::null(),
                    ptr::null(),
                    output_callback,
                    ctx as *mut c_void,
                    &mut session,
                );
                CFRelease(spec);
                if status == 0 && !session.is_null() {
                    break;
                }
                session = ptr::null();
            }
            if session.is_null() {
                drop(Box::from_raw(ctx));
                return None;
            }

            VTSessionSetProperty(session, kVTCompressionPropertyKey_RealTime, kCFBooleanTrue);
            VTSessionSetProperty(session, kVTCompressionPropertyKey_AllowFrameReordering, kCFBooleanFalse);
            // what every browser negotiates for WebRTC (profile-level-id 42e01f)
            VTSessionSetProperty(session, kVTCompressionPropertyKey_ProfileLevel, kVTProfileLevel_H264_ConstrainedBaseline_AutoLevel);
            set_owned(session, kVTCompressionPropertyKey_ExpectedFrameRate, number_i32(fps as i32));
            // keyframes are requested explicitly (new viewer / lost frame), so keep them rare
            set_owned(session, kVTCompressionPropertyKey_MaxKeyFrameInterval, number_i32(fps as i32 * 60));
            apply_bitrate(session, bitrate);
            VTCompressionSessionPrepareToEncodeFrames(session);

            Some(VtEncoder {
                bitrate,
                session,
                ctx,
                force_key_props: dict(&[kVTEncodeFrameOptionKey_ForceKeyFrame], &[kCFBooleanTrue]),
                width,
                height,
                started: Instant::now(),
                broken,
            })
        }
    }

    /// New target bitrate (bit/s), e.g. when the network gets slower or faster.
    pub fn set_bitrate(&mut self, bitrate: u32) {
        if bitrate != self.bitrate {
            unsafe { apply_bitrate(self.session, bitrate) };
            self.bitrate = bitrate;
        }
    }

    /// Size of a CVPixelBuffer.
    ///
    /// # Safety
    /// `pixel_buffer` must be a valid CVPixelBufferRef.
    pub unsafe fn buffer_size(pixel_buffer: *const c_void) -> (usize, usize) {
        (CVPixelBufferGetWidth(pixel_buffer), CVPixelBufferGetHeight(pixel_buffer))
    }

    /// Fingerprint of a frame's brightness plane – equal fingerprints, same picture (a static
    /// window is then not encoded again). About half a millisecond for 2560 × 1600.
    ///
    /// # Safety
    /// `pixel_buffer` must be a valid bi-planar CVPixelBufferRef.
    pub unsafe fn fingerprint(pixel_buffer: *const c_void) -> Option<u64> {
        const READ_ONLY: u64 = 1;
        if CVPixelBufferLockBaseAddress(pixel_buffer, READ_ONLY) != 0 {
            return None;
        }
        let base = CVPixelBufferGetBaseAddressOfPlane(pixel_buffer, 0) as *const u8;
        let (stride, width, height) = (CVPixelBufferGetBytesPerRowOfPlane(pixel_buffer, 0), CVPixelBufferGetWidthOfPlane(pixel_buffer, 0), CVPixelBufferGetHeightOfPlane(pixel_buffer, 0));
        let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
        if !base.is_null() {
            for y in 0..height {
                let row = base.add(y * stride);
                for i in 0..width / 8 {
                    let v = (row.add(i * 8) as *const u64).read_unaligned();
                    hash = (hash ^ v).wrapping_mul(0x0000_0100_0000_01b3).rotate_left(7);
                }
            }
        }
        CVPixelBufferUnlockBaseAddress(pixel_buffer, READ_ONLY);
        (!base.is_null()).then_some(hash)
    }

    /// Queue a frame. Returns whether a keyframe was requested.
    ///
    /// # Safety
    /// `pixel_buffer` must be a valid CVPixelBufferRef of this encoder's size.
    pub unsafe fn encode(&mut self, pixel_buffer: *const c_void, mut key: bool) -> bool {
        key |= self.broken.swap(false, Ordering::Relaxed);
        let pts = CMTime {
            value: self.started.elapsed().as_micros() as i64,
            timescale: 1_000_000,
            flags: 1,
            epoch: 0,
        };
        let props = if key { self.force_key_props } else { ptr::null() };
        let status = VTCompressionSessionEncodeFrame(
            self.session,
            pixel_buffer,
            pts,
            CM_TIME_INVALID,
            props,
            ptr::null_mut(),
            ptr::null_mut(),
        );
        if status != 0 {
            self.broken.store(true, Ordering::Relaxed);
        }
        key
    }
}

impl Drop for VtEncoder {
    fn drop(&mut self) {
        unsafe {
            VTCompressionSessionCompleteFrames(self.session, CM_TIME_INVALID);
            VTCompressionSessionInvalidate(self.session);
            CFRelease(self.session);
            CFRelease(self.force_key_props);
            drop(Box::from_raw(self.ctx));
        }
    }
}

extern "C" fn output_callback(refcon: *mut c_void, _src: *mut c_void, status: OSStatus, flags: u32, sample: CFTypeRef) {
    let ctx = unsafe { &*(refcon as *const Ctx) };
    if status != 0 || sample.is_null() || flags & FRAME_DROPPED != 0 {
        ctx.broken.store(true, Ordering::Relaxed);
        return;
    }
    match unsafe { annex_b(sample) } {
        Some((data, key)) => (ctx.sink)(data, key),
        None => ctx.broken.store(true, Ordering::Relaxed),
    }
}

unsafe fn annex_b(sample: CFTypeRef) -> Option<(Vec<u8>, bool)> {
    const START: [u8; 4] = [0, 0, 0, 1];

    let attachments = CMSampleBufferGetSampleAttachmentsArray(sample, 0);
    let key = attachments.is_null()
        || CFArrayGetCount(attachments) == 0
        || CFDictionaryGetValue(CFArrayGetValueAtIndex(attachments, 0), kCMSampleAttachmentKey_NotSync).is_null();

    let block = CMSampleBufferGetDataBuffer(sample);
    if block.is_null() {
        return None;
    }
    let len = CMBlockBufferGetDataLength(block);
    let mut avcc = vec![0u8; len];
    if CMBlockBufferCopyDataBytes(block, 0, len, avcc.as_mut_ptr() as *mut c_void) != 0 {
        return None;
    }

    let mut out = Vec::with_capacity(len + 128);
    let mut header_len = 4i32;
    if key {
        let desc = CMSampleBufferGetFormatDescription(sample);
        let mut count = 0usize;
        let (mut p, mut n) = (ptr::null(), 0usize);
        if CMVideoFormatDescriptionGetH264ParameterSetAtIndex(desc, 0, &mut p, &mut n, &mut count, &mut header_len) != 0 {
            return None;
        }
        for i in 0..count {
            if CMVideoFormatDescriptionGetH264ParameterSetAtIndex(desc, i, &mut p, &mut n, ptr::null_mut(), ptr::null_mut()) == 0 {
                out.extend_from_slice(&START);
                out.extend_from_slice(std::slice::from_raw_parts(p, n));
            }
        }
    }

    let header_len = header_len.clamp(1, 4) as usize;
    let mut i = 0;
    while i + header_len <= avcc.len() {
        let nal_len = avcc[i..i + header_len].iter().fold(0usize, |acc, b| acc << 8 | *b as usize);
        i += header_len;
        let end = (i + nal_len).min(avcc.len());
        out.extend_from_slice(&START);
        out.extend_from_slice(&avcc[i..end]);
        i = end;
    }
    Some((out, key))
}

/// Keeps one captured frame alive so it can be re-encoded as keyframe while the screen is idle.
pub struct RetainedBuffer(CFTypeRef);

unsafe impl Send for RetainedBuffer {}

impl RetainedBuffer {
    /// # Safety
    /// `pb` must be a valid CVPixelBufferRef.
    pub unsafe fn new(pb: *const c_void) -> Self {
        RetainedBuffer(CFRetain(pb))
    }

    pub fn as_ptr(&self) -> *const c_void {
        self.0
    }
}

impl Drop for RetainedBuffer {
    fn drop(&mut self) {
        unsafe { CFRelease(self.0) }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    #[link(name = "CoreVideo", kind = "framework")]
    extern "C" {
        fn CVPixelBufferCreate(a: CFTypeRef, w: usize, h: usize, fmt: u32, attrs: CFTypeRef, out: *mut CFTypeRef) -> i32;
        fn CVPixelBufferLockBaseAddress(pb: CFTypeRef, flags: u64) -> i32;
        fn CVPixelBufferUnlockBaseAddress(pb: CFTypeRef, flags: u64) -> i32;
        fn CVPixelBufferGetBaseAddress(pb: CFTypeRef) -> *mut u8;
        fn CVPixelBufferGetBytesPerRow(pb: CFTypeRef) -> usize;
    }

    /// Encodes synthetic BGRA frames; set PV_DUMP=path to write the Annex B stream for inspection.
    #[test]
    fn encodes_annex_b_with_parameter_sets() {
        let (w, h) = (640usize, 480usize);
        let out = Arc::new(Mutex::new(Vec::<(Vec<u8>, bool)>::new()));
        let sink_out = out.clone();
        let mut enc = VtEncoder::new(w, h, 30, 4_000_000, Box::new(move |d, k| sink_out.lock().unwrap().push((d, k)))).expect("session");
        for i in 0..30usize {
            unsafe {
                let mut pb: CFTypeRef = ptr::null();
                assert_eq!(CVPixelBufferCreate(ptr::null(), w, h, u32::from_be_bytes(*b"BGRA"), ptr::null(), &mut pb), 0);
                CVPixelBufferLockBaseAddress(pb, 0);
                let base = CVPixelBufferGetBaseAddress(pb);
                let stride = CVPixelBufferGetBytesPerRow(pb);
                for y in 0..h {
                    for x in 0..w {
                        let p = base.add(y * stride + x * 4);
                        *p = (x + i * 8) as u8;
                        *p.add(1) = y as u8;
                        *p.add(2) = (i * 20) as u8;
                        *p.add(3) = 255;
                    }
                }
                CVPixelBufferUnlockBaseAddress(pb, 0);
                enc.encode(pb, i == 0 || i == 20);
                CFRelease(pb);
            }
        }
        drop(enc); // flushes
        let out = out.lock().unwrap();
        assert!(out.len() >= 25, "got {} frames", out.len());
        let keys: Vec<usize> = out.iter().enumerate().filter(|(_, (_, k))| *k).map(|(i, _)| i).collect();
        assert!(keys.contains(&0) && keys.contains(&20), "keyframes at {keys:?}");
        let (first, _) = &out[0];
        assert_eq!(&first[..4], &[0, 0, 0, 1]);
        assert_eq!(first[4] & 0x1f, 7, "keyframe must start with SPS");
        if let Ok(path) = std::env::var("PV_DUMP") {
            std::fs::write(path, out.iter().flat_map(|(d, _)| d.clone()).collect::<Vec<_>>()).unwrap();
        }
    }
}
