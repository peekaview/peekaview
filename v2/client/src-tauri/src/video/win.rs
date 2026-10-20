//! Windows: Windows.Graphics.Capture (GPU frames) → D3D11 video processor (BGRA → NV12 and
//! scaling on the GPU) → Media Foundation H.264 encoder. Media Foundation picks the GPU vendor's
//! hardware encoder (Intel Quick Sync, NVIDIA NVENC, AMD AMF) and gets the textures without a
//! copy; without one, Windows' software encoder takes over (frames are then read back).
//!
//! A shared window is captured on its own: other windows, the desktop and notifications are never
//! part of the picture. All COM objects live on one thread.

use std::{
    mem::ManuallyDrop,
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc as std_mpsc, Arc,
    },
    thread::{self, JoinHandle},
    time::{Duration, Instant},
};

use tokio::sync::mpsc;
use windows::{
    core::{Interface, GUID},
    Graphics::{
        Capture::{Direct3D11CaptureFramePool, GraphicsCaptureItem, GraphicsCaptureSession},
        DirectX::{Direct3D11::IDirect3DDevice, DirectXPixelFormat},
        SizeInt32,
    },
    Win32::{
        Foundation::{HMODULE, HWND},
        Graphics::{
            Direct3D::D3D_DRIVER_TYPE_HARDWARE,
            Direct3D11::*,
            Dxgi::{Common::*, IDXGIDevice},
            Gdi::HMONITOR,
        },
        Media::MediaFoundation::*,
        System::{
            Com::CoTaskMemFree,
            Variant::VARIANT,
            WinRT::{
                Direct3D11::{CreateDirect3D11DeviceFromDXGIDevice, IDirect3DDxgiInterfaceAccess},
                Graphics::Capture::IGraphicsCaptureItemInterop,
                RoInitialize, RO_INIT_MULTITHREADED,
            },
        },
    },
};

use super::{output_size, packet, Source, FPS, KEY_GAP};
use crate::{guard::Rect, session::Shared};

type Result<T> = std::result::Result<T, String>;

fn err(context: &str) -> impl Fn(windows::core::Error) -> String + '_ {
    move |e| format!("{context}: {e}")
}

pub struct Video {
    stop: Arc<AtomicBool>,
    thread: Option<JoinHandle<()>>,
}

impl Video {
    pub fn start(source: Source, _rect: Rect, shared: Arc<Shared>, frames: mpsc::Sender<Vec<u8>>) -> Result<Self> {
        let stop = Arc::new(AtomicBool::new(false));
        let (ready_tx, ready_rx) = std_mpsc::channel();
        let thread = {
            let stop = stop.clone();
            thread::spawn(move || {
                let _ = unsafe { RoInitialize(RO_INIT_MULTITHREADED) };
                let _ = unsafe { MFStartup(MF_VERSION, MFSTARTUP_FULL) };
                match Pipeline::new(&source, shared, frames) {
                    Ok(mut pipeline) => {
                        let _ = ready_tx.send(Ok(()));
                        if let Err(e) = pipeline.run(&stop) {
                            crate::log(&format!("video: {e}"));
                        }
                    }
                    Err(e) => {
                        let _ = ready_tx.send(Err(e));
                    }
                }
                let _ = unsafe { MFShutdown() };
            })
        };
        ready_rx.recv().map_err(|_| "Bildschirmaufnahme konnte nicht starten".to_string())??;
        Ok(Video { stop, thread: Some(thread) })
    }

    /// Size changes are picked up from the captured frames themselves.
    pub fn update(&mut self, _rect: Rect) {}

    /// Keyframe requests while the picture is static are answered on the capture thread.
    pub fn tick(&mut self) {}
}

impl Drop for Video {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

// ---------------------------------------------------------------------------------------------

struct Pipeline {
    device: ID3D11Device,
    context: ID3D11DeviceContext,
    winrt_device: IDirect3DDevice,
    pool: Direct3D11CaptureFramePool,
    session: GraphicsCaptureSession,
    pool_size: SizeInt32,
    converter: Option<Converter>,
    encoder: Option<Encoder>,
    shared: Arc<Shared>,
    frames: mpsc::Sender<Vec<u8>>,
    dirty: bool,
    have_frame: bool,
    last_input: Instant,
    last_key: Instant,
}

fn create_device() -> Result<(ID3D11Device, ID3D11DeviceContext)> {
    let mut device = None;
    let mut context = None;
    unsafe {
        D3D11CreateDevice(
            None,
            D3D_DRIVER_TYPE_HARDWARE,
            HMODULE::default(),
            D3D11_CREATE_DEVICE_BGRA_SUPPORT | D3D11_CREATE_DEVICE_VIDEO_SUPPORT,
            None,
            D3D11_SDK_VERSION,
            Some(&mut device),
            None,
            Some(&mut context),
        )
        .map_err(err("D3D11-Gerät"))?;
    }
    let device = device.ok_or("kein D3D11-Gerät")?;
    // Media Foundation uses the device from its own threads
    if let Ok(mt) = device.cast::<ID3D11Multithread>() {
        unsafe {
            let _ = mt.SetMultithreadProtected(true);
        }
    }
    Ok((device, context.ok_or("kein D3D11-Kontext")?))
}

fn capture_item(source: &Source) -> Result<GraphicsCaptureItem> {
    let interop = windows::core::factory::<GraphicsCaptureItem, IGraphicsCaptureItemInterop>().map_err(err("Capture-Interop"))?;
    unsafe {
        match source {
            Source::Window(w) => {
                let hwnd = HWND(w.id().map_err(|e| e.to_string())? as usize as *mut _);
                interop.CreateForWindow(hwnd).map_err(err("Fenster aufnehmen"))
            }
            Source::Screen(m) => {
                let monitor = HMONITOR(m.id().map_err(|e| e.to_string())? as usize as *mut _);
                interop.CreateForMonitor(monitor).map_err(err("Bildschirm aufnehmen"))
            }
        }
    }
}

impl Pipeline {
    fn new(source: &Source, shared: Arc<Shared>, frames: mpsc::Sender<Vec<u8>>) -> Result<Self> {
        let (device, context) = create_device()?;
        let dxgi: IDXGIDevice = device.cast().map_err(err("DXGI"))?;
        let winrt_device: IDirect3DDevice = unsafe { CreateDirect3D11DeviceFromDXGIDevice(&dxgi) }
            .map_err(err("WinRT-Gerät"))?
            .cast()
            .map_err(err("WinRT-Gerät"))?;
        let item = capture_item(source)?;
        let pool_size = item.Size().map_err(err("Größe"))?;
        let pool = Direct3D11CaptureFramePool::CreateFreeThreaded(&winrt_device, DirectXPixelFormat::B8G8R8A8UIntNormalized, 2, pool_size)
            .map_err(err("Frame-Pool"))?;
        let session = pool.CreateCaptureSession(&item).map_err(err("Capture-Sitzung"))?;
        // our own pointer and annotations are sent separately; no yellow border (Windows 11)
        let _ = session.SetIsCursorCaptureEnabled(false);
        let _ = session.SetIsBorderRequired(false);
        session.StartCapture().map_err(err("Aufnahme starten"))?;
        Ok(Pipeline {
            device,
            context,
            winrt_device,
            pool,
            session,
            pool_size,
            converter: None,
            encoder: None,
            shared,
            frames,
            dirty: false,
            have_frame: false,
            last_input: Instant::now(),
            last_key: Instant::now() - KEY_GAP,
        })
    }

    fn run(&mut self, stop: &AtomicBool) -> Result<()> {
        let frame_interval = Duration::from_millis(1000 / FPS as u64);
        while !stop.load(Ordering::Relaxed) {
            // newest captured frame → NV12 (GPU)
            while let Ok(frame) = self.pool.TryGetNextFrame() {
                let size = frame.ContentSize().map_err(err("Frame"))?;
                if size.Width <= 0 || size.Height <= 0 {
                    continue;
                }
                if size.Width != self.pool_size.Width || size.Height != self.pool_size.Height {
                    // the window was resized: new pool size, the next frame has the new size
                    self.pool_size = size;
                    self.pool
                        .Recreate(&self.winrt_device, DirectXPixelFormat::B8G8R8A8UIntNormalized, 2, size)
                        .map_err(err("Frame-Pool"))?;
                    continue;
                }
                let texture: ID3D11Texture2D = unsafe {
                    frame.Surface().map_err(err("Frame"))?.cast::<IDirect3DDxgiInterfaceAccess>().map_err(err("Frame"))?.GetInterface()
                }
                .map_err(err("Frame"))?;
                self.convert(&texture, size)?;
                self.dirty = true;
                self.have_frame = true;
            }

            let want_key = self.shared.need_key.load(Ordering::Relaxed) && self.last_key.elapsed() >= KEY_GAP;
            // static picture but a keyframe is wanted: encode the last frame again
            if want_key && self.have_frame && !self.dirty && self.last_input.elapsed() > Duration::from_millis(150) {
                self.dirty = true;
            }
            if self.dirty && self.last_input.elapsed() >= frame_interval {
                if self.encode(want_key)? {
                    self.dirty = false;
                    self.last_input = Instant::now();
                    if want_key {
                        self.shared.need_key.store(false, Ordering::Relaxed);
                        self.last_key = Instant::now();
                    }
                }
            } else {
                self.drain()?;
            }
            thread::sleep(Duration::from_millis(2));
        }
        let _ = self.session.Close();
        let _ = self.pool.Close();
        Ok(())
    }

    fn convert(&mut self, texture: &ID3D11Texture2D, size: SizeInt32) -> Result<()> {
        let (w, h) = (size.Width as u32, size.Height as u32);
        let out = output_size(w as f64, h as f64);
        if self.converter.as_ref().is_none_or(|c| c.input != (w, h) || c.output != out) {
            self.converter = Some(Converter::new(&self.device, &self.context, (w, h), out)?);
        }
        if self.encoder.as_ref().is_none_or(|e| (e.width, e.height) != out) {
            self.encoder = Some(Encoder::new(&self.device, out.0, out.1)?);
            self.shared.need_key.store(true, Ordering::Relaxed);
            self.last_key = Instant::now() - KEY_GAP;
        }
        self.converter.as_mut().unwrap().blt(texture)
    }

    /// Feeds the current NV12 frame to the encoder. Returns whether it was taken.
    fn encode(&mut self, key: bool) -> Result<bool> {
        let (Some(converter), Some(encoder)) = (self.converter.as_mut(), self.encoder.as_mut()) else { return Ok(false) };
        let (frames, shared) = (&self.frames, &self.shared);
        let (w, h) = (encoder.width as usize, encoder.height as usize);
        let mut sink = |data: Vec<u8>, key: bool| {
            if frames.try_send(packet(&data, key, w, h)).is_err() {
                shared.need_key.store(true, Ordering::Relaxed);
            }
        };
        let taken = encoder.feed(&self.context, converter.current(), key, &mut sink)?;
        if taken {
            converter.rotate();
        }
        Ok(taken)
    }

    fn drain(&mut self) -> Result<()> {
        let Some(encoder) = self.encoder.as_mut() else { return Ok(()) };
        let (frames, shared) = (&self.frames, &self.shared);
        let (w, h) = (encoder.width as usize, encoder.height as usize);
        let mut sink = |data: Vec<u8>, key: bool| {
            if frames.try_send(packet(&data, key, w, h)).is_err() {
                shared.need_key.store(true, Ordering::Relaxed);
            }
        };
        encoder.poll(&mut sink)
    }
}

// --------------------------------------------------------------------------------------------- GPU color conversion

/// BGRA (any size) → NV12 (output size) with the D3D11 video processor. Keeps a small ring of
/// output textures: an asynchronous encoder may still read the previous one.
struct Converter {
    input: (u32, u32),
    output: (u32, u32),
    context: ID3D11DeviceContext,
    video_context: ID3D11VideoContext,
    processor: ID3D11VideoProcessor,
    staging: ID3D11Texture2D,
    input_view: ID3D11VideoProcessorInputView,
    outputs: Vec<(ID3D11Texture2D, ID3D11VideoProcessorOutputView)>,
    index: usize,
}

impl Converter {
    fn new(device: &ID3D11Device, context: &ID3D11DeviceContext, input: (u32, u32), output: (u32, u32)) -> Result<Self> {
        let video_device: ID3D11VideoDevice = device.cast().map_err(err("Video-Gerät"))?;
        let video_context: ID3D11VideoContext = context.cast().map_err(err("Video-Kontext"))?;
        let desc = D3D11_VIDEO_PROCESSOR_CONTENT_DESC {
            InputFrameFormat: D3D11_VIDEO_FRAME_FORMAT_PROGRESSIVE,
            InputFrameRate: DXGI_RATIONAL { Numerator: FPS, Denominator: 1 },
            InputWidth: input.0,
            InputHeight: input.1,
            OutputFrameRate: DXGI_RATIONAL { Numerator: FPS, Denominator: 1 },
            OutputWidth: output.0,
            OutputHeight: output.1,
            Usage: D3D11_VIDEO_USAGE_OPTIMAL_SPEED,
        };
        let enumerator = unsafe { video_device.CreateVideoProcessorEnumerator(&desc) }.map_err(err("Videoprozessor"))?;
        let processor = unsafe { video_device.CreateVideoProcessor(&enumerator, 0) }.map_err(err("Videoprozessor"))?;

        let texture = |width: u32, height: u32, format: DXGI_FORMAT, bind: D3D11_BIND_FLAG| -> Result<ID3D11Texture2D> {
            let desc = D3D11_TEXTURE2D_DESC {
                Width: width,
                Height: height,
                MipLevels: 1,
                ArraySize: 1,
                Format: format,
                SampleDesc: DXGI_SAMPLE_DESC { Count: 1, Quality: 0 },
                Usage: D3D11_USAGE_DEFAULT,
                BindFlags: bind.0 as u32,
                CPUAccessFlags: 0,
                MiscFlags: 0,
            };
            let mut tex = None;
            unsafe { device.CreateTexture2D(&desc, None, Some(&mut tex)) }.map_err(err("Textur"))?;
            tex.ok_or_else(|| "Textur".to_string())
        };

        let staging = texture(input.0, input.1, DXGI_FORMAT_B8G8R8A8_UNORM, D3D11_BIND_RENDER_TARGET | D3D11_BIND_SHADER_RESOURCE)?;
        let input_view_desc = D3D11_VIDEO_PROCESSOR_INPUT_VIEW_DESC {
            FourCC: 0,
            ViewDimension: D3D11_VPIV_DIMENSION_TEXTURE2D,
            Anonymous: D3D11_VIDEO_PROCESSOR_INPUT_VIEW_DESC_0 { Texture2D: D3D11_TEX2D_VPIV { MipSlice: 0, ArraySlice: 0 } },
        };
        let mut input_view = None;
        unsafe { video_device.CreateVideoProcessorInputView(&staging, &enumerator, &input_view_desc, Some(&mut input_view)) }
            .map_err(err("Eingabe-View"))?;

        let output_view_desc = D3D11_VIDEO_PROCESSOR_OUTPUT_VIEW_DESC {
            ViewDimension: D3D11_VPOV_DIMENSION_TEXTURE2D,
            Anonymous: D3D11_VIDEO_PROCESSOR_OUTPUT_VIEW_DESC_0 { Texture2D: D3D11_TEX2D_VPOV { MipSlice: 0 } },
        };
        let mut outputs = Vec::new();
        for _ in 0..3 {
            let tex = texture(output.0, output.1, DXGI_FORMAT_NV12, D3D11_BIND_RENDER_TARGET)?;
            let mut view = None;
            unsafe { video_device.CreateVideoProcessorOutputView(&tex, &enumerator, &output_view_desc, Some(&mut view)) }
                .map_err(err("Ausgabe-View"))?;
            outputs.push((tex, view.ok_or("Ausgabe-View")?));
        }

        Ok(Converter {
            input,
            output,
            context: context.clone(),
            video_context,
            processor,
            staging,
            input_view: input_view.ok_or("Eingabe-View")?,
            outputs,
            index: 0,
        })
    }

    fn blt(&mut self, frame: &ID3D11Texture2D) -> Result<()> {
        let region = D3D11_BOX { left: 0, top: 0, front: 0, right: self.input.0, bottom: self.input.1, back: 1 };
        unsafe {
            self.context.CopySubresourceRegion(&self.staging, 0, 0, 0, 0, frame, 0, Some(&region));
        }
        let stream = D3D11_VIDEO_PROCESSOR_STREAM {
            Enable: true.into(),
            OutputIndex: 0,
            InputFrameOrField: 0,
            PastFrames: 0,
            FutureFrames: 0,
            ppPastSurfaces: std::ptr::null_mut(),
            pInputSurface: ManuallyDrop::new(Some(self.input_view.clone())),
            ppFutureSurfaces: std::ptr::null_mut(),
            ppPastSurfacesRight: std::ptr::null_mut(),
            pInputSurfaceRight: ManuallyDrop::new(None),
            ppFutureSurfacesRight: std::ptr::null_mut(),
        };
        let streams = [stream];
        let result = unsafe { self.video_context.VideoProcessorBlt(&self.processor, &self.outputs[self.index].1, 0, &streams) };
        // release the view reference held by the stream description
        let [mut stream] = streams;
        unsafe { ManuallyDrop::drop(&mut stream.pInputSurface) };
        result.map_err(err("Farbumwandlung"))
    }

    fn current(&self) -> &ID3D11Texture2D {
        &self.outputs[self.index].0
    }

    fn rotate(&mut self) {
        self.index = (self.index + 1) % self.outputs.len();
    }
}

// --------------------------------------------------------------------------------------------- Media Foundation

struct Encoder {
    width: u32,
    height: u32,
    transform: IMFTransform,
    events: Option<IMFMediaEventGenerator>,
    codec: Option<ICodecAPI>,
    _manager: IMFDXGIDeviceManager,
    d3d_aware: bool,
    provides_samples: bool,
    output_size: u32,
    need_input: u32,
    readback: Option<ID3D11Texture2D>,
    started: Instant,
    sequence_header: Vec<u8>,
}

fn variant_u32(v: u32) -> VARIANT {
    VARIANT::from(v)
}

fn variant_bool(v: bool) -> VARIANT {
    VARIANT::from(v)
}

/// First Media Foundation H.264 encoder for NV12 input matching `flags`.
fn find_encoder(flags: MFT_ENUM_FLAG) -> Option<IMFTransform> {
    let input = MFT_REGISTER_TYPE_INFO { guidMajorType: MFMediaType_Video, guidSubtype: MFVideoFormat_NV12 };
    let output = MFT_REGISTER_TYPE_INFO { guidMajorType: MFMediaType_Video, guidSubtype: MFVideoFormat_H264 };
    let mut activates: *mut Option<IMFActivate> = std::ptr::null_mut();
    let mut count = 0u32;
    unsafe {
        MFTEnumEx(MFT_CATEGORY_VIDEO_ENCODER, flags, Some(&input), Some(&output), &mut activates, &mut count).ok()?;
        if activates.is_null() {
            return None;
        }
        let list = std::slice::from_raw_parts_mut(activates, count as usize);
        let transform = list.iter().flatten().find_map(|a| a.ActivateObject::<IMFTransform>().ok());
        for a in list.iter_mut() {
            drop(a.take());
        }
        CoTaskMemFree(Some(activates as *const _));
        transform
    }
}

impl Encoder {
    fn new(device: &ID3D11Device, width: u32, height: u32) -> Result<Self> {
        // the GPU's hardware encoder; Windows' software encoder as fallback
        let (transform, hardware) = match find_encoder(MFT_ENUM_FLAG_HARDWARE | MFT_ENUM_FLAG_SORTANDFILTER) {
            Some(t) => (t, true),
            None => (find_encoder(MFT_ENUM_FLAG_SYNCMFT | MFT_ENUM_FLAG_SORTANDFILTER).ok_or("kein H.264-Encoder gefunden")?, false),
        };
        crate::log(&format!("video: Media Foundation H.264 encoder ({})", if hardware { "hardware" } else { "software" }));

        let mut reset_token = 0u32;
        let mut manager = None;
        unsafe { MFCreateDXGIDeviceManager(&mut reset_token, &mut manager) }.map_err(err("DXGI-Manager"))?;
        let manager = manager.ok_or("DXGI-Manager")?;
        unsafe { manager.ResetDevice(device, reset_token) }.map_err(err("DXGI-Manager"))?;

        let mut d3d_aware = false;
        if let Ok(attributes) = unsafe { transform.GetAttributes() } {
            unsafe {
                if hardware {
                    // hardware encoders are asynchronous and must be unlocked explicitly
                    let _ = attributes.SetUINT32(&MF_TRANSFORM_ASYNC_UNLOCK, 1);
                }
                d3d_aware = attributes.GetUINT32(&MF_SA_D3D11_AWARE).unwrap_or(0) == 1;
                let _ = attributes.SetUINT32(&MF_LOW_LATENCY, 1);
            }
        }
        if d3d_aware {
            unsafe { transform.ProcessMessage(MFT_MESSAGE_SET_D3D_MANAGER, manager.as_raw() as usize) }.map_err(err("D3D-Manager"))?;
        }

        let bitrate = ((width * height) as f64 * FPS as f64 * 0.05).clamp(1.5e6, 12e6) as u32;
        let codec = transform.cast::<ICodecAPI>().ok();
        if let Some(codec) = &codec {
            unsafe {
                let _ = codec.SetValue(&CODECAPI_AVEncCommonRateControlMode, &variant_u32(eAVEncCommonRateControlMode_CBR.0 as u32));
                let _ = codec.SetValue(&CODECAPI_AVEncCommonMeanBitRate, &variant_u32(bitrate));
                let _ = codec.SetValue(&CODECAPI_AVLowLatencyMode, &variant_bool(true));
                // keyframes are requested explicitly (new viewer / lost packets)
                let _ = codec.SetValue(&CODECAPI_AVEncMPVGOPSize, &variant_u32(FPS * 60));
                let _ = codec.SetValue(&CODECAPI_AVEncMPVDefaultBPictureCount, &variant_u32(0));
            }
        }

        let media_type = |subtype: &GUID| -> Result<IMFMediaType> {
            let t = unsafe { MFCreateMediaType() }.map_err(err("Medientyp"))?;
            unsafe {
                t.SetGUID(&MF_MT_MAJOR_TYPE, &MFMediaType_Video).map_err(err("Medientyp"))?;
                t.SetGUID(&MF_MT_SUBTYPE, subtype).map_err(err("Medientyp"))?;
                t.SetUINT64(&MF_MT_FRAME_SIZE, ((width as u64) << 32) | height as u64).map_err(err("Medientyp"))?;
                t.SetUINT64(&MF_MT_FRAME_RATE, ((FPS as u64) << 32) | 1).map_err(err("Medientyp"))?;
                t.SetUINT64(&MF_MT_PIXEL_ASPECT_RATIO, (1u64 << 32) | 1).map_err(err("Medientyp"))?;
                t.SetUINT32(&MF_MT_INTERLACE_MODE, MFVideoInterlace_Progressive.0 as u32).map_err(err("Medientyp"))?;
            }
            Ok(t)
        };
        // output before input: H.264, Constrained Baseline – what every browser negotiates for WebRTC
        let output = media_type(&MFVideoFormat_H264)?;
        unsafe {
            output.SetUINT32(&MF_MT_AVG_BITRATE, bitrate).map_err(err("Medientyp"))?;
            output.SetUINT32(&MF_MT_MPEG2_PROFILE, eAVEncH264VProfile_ConstrainedBase.0 as u32).map_err(err("Medientyp"))?;
            transform.SetOutputType(0, &output, 0).map_err(err("Ausgabeformat"))?;
        }
        let input = media_type(&MFVideoFormat_NV12)?;
        unsafe { transform.SetInputType(0, &input, 0) }.map_err(err("Eingabeformat"))?;

        let info = unsafe { transform.GetOutputStreamInfo(0) }.map_err(err("Ausgabestrom"))?;
        let provides_samples = info.dwFlags & (MFT_OUTPUT_STREAM_PROVIDES_SAMPLES.0 as u32 | MFT_OUTPUT_STREAM_CAN_PROVIDE_SAMPLES.0 as u32) != 0;

        let events = if hardware { transform.cast::<IMFMediaEventGenerator>().ok() } else { None };
        unsafe {
            let _ = transform.ProcessMessage(MFT_MESSAGE_COMMAND_FLUSH, 0);
            transform.ProcessMessage(MFT_MESSAGE_NOTIFY_BEGIN_STREAMING, 0).map_err(err("Encoder starten"))?;
            transform.ProcessMessage(MFT_MESSAGE_NOTIFY_START_OF_STREAM, 0).map_err(err("Encoder starten"))?;
        }

        // without D3D support the encoder gets frames from system memory
        let readback = if d3d_aware {
            None
        } else {
            let desc = D3D11_TEXTURE2D_DESC {
                Width: width,
                Height: height,
                MipLevels: 1,
                ArraySize: 1,
                Format: DXGI_FORMAT_NV12,
                SampleDesc: DXGI_SAMPLE_DESC { Count: 1, Quality: 0 },
                Usage: D3D11_USAGE_STAGING,
                BindFlags: 0,
                CPUAccessFlags: D3D11_CPU_ACCESS_READ.0 as u32,
                MiscFlags: 0,
            };
            let mut tex = None;
            unsafe { device.CreateTexture2D(&desc, None, Some(&mut tex)) }.map_err(err("Readback-Textur"))?;
            tex
        };

        Ok(Encoder {
            width,
            height,
            transform,
            events,
            codec,
            _manager: manager,
            d3d_aware,
            provides_samples,
            output_size: info.cbSize.max(width * height),
            // a synchronous encoder always takes input
            need_input: if hardware { 0 } else { u32::MAX },
            readback,
            started: Instant::now(),
            sequence_header: Vec::new(),
        })
    }

    /// Handles pending encoder events (asynchronous hardware encoders).
    fn poll(&mut self, sink: &mut dyn FnMut(Vec<u8>, bool)) -> Result<()> {
        let Some(events) = self.events.clone() else { return Ok(()) };
        loop {
            let event = match unsafe { events.GetEvent(MF_EVENT_FLAG_NO_WAIT) } {
                Ok(e) => e,
                Err(e) if e.code() == MF_E_NO_EVENTS_AVAILABLE => return Ok(()),
                Err(e) => return Err(format!("Encoder-Ereignis: {e}")),
            };
            match unsafe { event.GetType() }.map_err(err("Encoder-Ereignis"))? as i32 {
                t if t == METransformNeedInput.0 => self.need_input += 1,
                t if t == METransformHaveOutput.0 => {
                    self.output(sink)?;
                }
                _ => {}
            }
        }
    }

    /// Submits a frame if the encoder wants one. Returns whether it was taken.
    fn feed(&mut self, context: &ID3D11DeviceContext, frame: &ID3D11Texture2D, key: bool, sink: &mut dyn FnMut(Vec<u8>, bool)) -> Result<bool> {
        self.poll(sink)?;
        if self.need_input == 0 {
            return Ok(false);
        }
        if key {
            if let Some(codec) = &self.codec {
                let _ = unsafe { codec.SetValue(&CODECAPI_AVEncVideoForceKeyFrame, &variant_u32(1)) };
            }
        }
        let buffer = if self.d3d_aware {
            unsafe { MFCreateDXGISurfaceBuffer(&ID3D11Texture2D::IID, frame, 0, false) }.map_err(err("Eingabepuffer"))?
        } else {
            self.read_back(context, frame)?
        };
        let sample = unsafe { MFCreateSample() }.map_err(err("Sample"))?;
        unsafe {
            sample.AddBuffer(&buffer).map_err(err("Sample"))?;
            sample.SetSampleTime((self.started.elapsed().as_nanos() / 100) as i64).map_err(err("Sample"))?;
            sample.SetSampleDuration(10_000_000 / FPS as i64).map_err(err("Sample"))?;
            self.transform.ProcessInput(0, &sample, 0).map_err(err("Kodieren"))?;
        }
        if self.events.is_some() {
            self.need_input -= 1;
        } else {
            // synchronous encoder: collect what is ready right away
            while self.output(sink)? {}
        }
        Ok(true)
    }

    /// NV12 texture → system memory buffer (software encoder only).
    fn read_back(&self, context: &ID3D11DeviceContext, frame: &ID3D11Texture2D) -> Result<IMFMediaBuffer> {
        let staging = self.readback.as_ref().ok_or("Readback-Textur")?;
        let (w, h) = (self.width as usize, self.height as usize);
        let size = w * h * 3 / 2;
        let buffer = unsafe { MFCreateMemoryBuffer(size as u32) }.map_err(err("Speicherpuffer"))?;
        unsafe {
            context.CopyResource(staging, frame);
            let mut mapped = D3D11_MAPPED_SUBRESOURCE::default();
            context.Map(staging, 0, D3D11_MAP_READ, 0, Some(&mut mapped)).map_err(err("Readback"))?;
            let mut dst: *mut u8 = std::ptr::null_mut();
            buffer.Lock(&mut dst, None, None).map_err(err("Speicherpuffer"))?;
            let src = mapped.pData as *const u8;
            let pitch = mapped.RowPitch as usize;
            // Y plane, then the interleaved UV plane (it starts after `h` rows of the mapping)
            for row in 0..h {
                std::ptr::copy_nonoverlapping(src.add(row * pitch), dst.add(row * w), w);
            }
            for row in 0..h / 2 {
                std::ptr::copy_nonoverlapping(src.add((h + row) * pitch), dst.add(w * h + row * w), w);
            }
            let _ = buffer.Unlock();
            context.Unmap(staging, 0);
            buffer.SetCurrentLength(size as u32).map_err(err("Speicherpuffer"))?;
        }
        Ok(buffer)
    }

    /// Takes one encoded frame from the encoder. Returns false if none was ready.
    fn output(&mut self, sink: &mut dyn FnMut(Vec<u8>, bool)) -> Result<bool> {
        let own_sample = if self.provides_samples {
            None
        } else {
            let sample = unsafe { MFCreateSample() }.map_err(err("Sample"))?;
            let buffer = unsafe { MFCreateMemoryBuffer(self.output_size) }.map_err(err("Ausgabepuffer"))?;
            unsafe { sample.AddBuffer(&buffer) }.map_err(err("Sample"))?;
            Some(sample)
        };
        let mut buffers = [MFT_OUTPUT_DATA_BUFFER {
            dwStreamID: 0,
            pSample: ManuallyDrop::new(own_sample),
            dwStatus: 0,
            pEvents: ManuallyDrop::new(None),
        }];
        let mut status = 0u32;
        let result = unsafe { self.transform.ProcessOutput(0, &mut buffers, &mut status) };
        let [mut buffer] = buffers;
        let sample = unsafe { ManuallyDrop::take(&mut buffer.pSample) };
        unsafe { ManuallyDrop::drop(&mut buffer.pEvents) };
        match result {
            Err(e) if e.code() == MF_E_TRANSFORM_NEED_MORE_INPUT => return Ok(false),
            Err(e) if e.code() == MF_E_TRANSFORM_STREAM_CHANGE => {
                // the encoder settled its output format (e.g. level); accept it
                let t = unsafe { self.transform.GetOutputAvailableType(0, 0) }.map_err(err("Formatwechsel"))?;
                unsafe { self.transform.SetOutputType(0, &t, 0) }.map_err(err("Formatwechsel"))?;
                return Ok(true);
            }
            Err(e) => return Err(format!("Kodieren: {e}")),
            Ok(()) => {}
        }
        let Some(sample) = sample else { return Ok(true) };
        let key = unsafe { sample.GetUINT32(&MFSampleExtension_CleanPoint) }.unwrap_or(0) == 1;
        let buffer = unsafe { sample.ConvertToContiguousBuffer() }.map_err(err("Ausgabe"))?;
        let mut data = Vec::new();
        unsafe {
            let mut ptr: *mut u8 = std::ptr::null_mut();
            let mut len = 0u32;
            buffer.Lock(&mut ptr, None, Some(&mut len)).map_err(err("Ausgabe"))?;
            data.extend_from_slice(std::slice::from_raw_parts(ptr, len as usize));
            let _ = buffer.Unlock();
        }
        if data.is_empty() {
            return Ok(true);
        }
        // every keyframe must carry SPS/PPS so a viewer can start there
        if key && !has_nal(&data, 7) {
            if self.sequence_header.is_empty() {
                self.sequence_header = self.read_sequence_header();
            }
            data = [self.sequence_header.as_slice(), &data].concat();
        } else if key && self.sequence_header.is_empty() {
            self.sequence_header = parameter_sets(&data);
        }
        sink(data, key);
        Ok(true)
    }

    fn read_sequence_header(&self) -> Vec<u8> {
        unsafe {
            let Ok(t) = self.transform.GetOutputCurrentType(0) else { return Vec::new() };
            let Ok(size) = t.GetBlobSize(&MF_MT_MPEG_SEQUENCE_HEADER) else { return Vec::new() };
            let mut blob = vec![0u8; size as usize];
            if t.GetBlob(&MF_MT_MPEG_SEQUENCE_HEADER, &mut blob, None).is_err() {
                return Vec::new();
            }
            blob
        }
    }
}

impl Drop for Encoder {
    fn drop(&mut self) {
        unsafe {
            let _ = self.transform.ProcessMessage(MFT_MESSAGE_NOTIFY_END_OF_STREAM, 0);
            let _ = self.transform.ProcessMessage(MFT_MESSAGE_COMMAND_DRAIN, 0);
            let _ = self.transform.ProcessMessage(MFT_MESSAGE_NOTIFY_END_STREAMING, 0);
        }
    }
}

/// Positions of NAL units in an Annex B stream: (start of header byte, type).
fn nal_units(data: &[u8]) -> Vec<(usize, u8)> {
    let mut units = Vec::new();
    let mut i = 0;
    while i + 3 < data.len() {
        if data[i] == 0 && data[i + 1] == 0 && data[i + 2] == 1 {
            units.push((i + 3, data[i + 3] & 0x1f));
            i += 3;
        } else {
            i += 1;
        }
    }
    units
}

fn has_nal(data: &[u8], kind: u8) -> bool {
    nal_units(data).iter().any(|(_, t)| *t == kind)
}

/// SPS + PPS (with start codes) from a keyframe.
fn parameter_sets(data: &[u8]) -> Vec<u8> {
    let units = nal_units(data);
    let mut out = Vec::new();
    for (n, (start, kind)) in units.iter().enumerate() {
        if *kind == 7 || *kind == 8 {
            let end = units.get(n + 1).map(|(s, _)| s - 3).unwrap_or(data.len());
            out.extend_from_slice(&[0, 0, 0, 1]);
            out.extend_from_slice(&data[*start..end]);
        }
    }
    out
}
