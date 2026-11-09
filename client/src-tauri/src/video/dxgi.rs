//! Windows: DXGI Desktop Duplication – the second capture backend, for the SYSTEM helper of the
//! PeekaView service. Windows.Graphics.Capture does not work on the secure desktop (sign-in screen,
//! lock screen, UAC prompts); Desktop Duplication does, as long as the capturing thread sits on
//! the input desktop.
//!
//! The duplicated frame is copied into a texture of our own and then goes through the same D3D11
//! video processor and Media Foundation encoder as WGC frames (`win.rs`). When the input desktop
//! changes (Default ↔ Winlogon) or the display mode changes, the duplication is lost: the thread
//! moves to the new input desktop and duplicates the output again – the next frame is a keyframe.

use std::time::{Duration, Instant};

use windows::{
    core::Interface,
    Win32::Graphics::{
        Direct3D11::*,
        Dxgi::{IDXGIDevice, IDXGIOutput1, IDXGIOutputDuplication, IDXGIResource, DXGI_ERROR_WAIT_TIMEOUT, DXGI_OUTDUPL_FRAME_INFO},
        Gdi::HMONITOR,
    },
};

type Result<T> = std::result::Result<T, String>;

/// How long to wait before duplicating again after the duplication was lost.
const RETRY: Duration = Duration::from_millis(250);

pub struct Duplication {
    monitor: HMONITOR,
    dup: Option<IDXGIOutputDuplication>,
    copy: Option<ID3D11Texture2D>,
    size: (u32, u32),
    retry_at: Instant,
    /// the last error, logged once until it changes
    logged: String,
}

impl Duplication {
    pub fn new(device: &ID3D11Device, monitor: HMONITOR) -> Result<Self> {
        let mut d = Duplication { monitor, dup: None, copy: None, size: (0, 0), retry_at: Instant::now(), logged: String::new() };
        d.open(device)?;
        Ok(d)
    }

    fn open(&mut self, device: &ID3D11Device) -> Result<()> {
        // the helper: duplicate the desktop that currently receives input
        if crate::unattended::helper() {
            crate::unattended::desk::win::follow_input_desktop();
        }
        let dxgi: IDXGIDevice = device.cast().map_err(|e| format!("DXGI: {e}"))?;
        let adapter = unsafe { dxgi.GetAdapter() }.map_err(|e| format!("Grafikkarte: {e}"))?;
        let mut i = 0;
        let output = loop {
            let output = unsafe { adapter.EnumOutputs(i) }.map_err(|_| "Bildschirm hängt nicht an dieser Grafikkarte".to_string())?;
            if unsafe { output.GetDesc() }.is_ok_and(|d| d.Monitor == self.monitor) {
                break output;
            }
            i += 1;
        };
        let output: IDXGIOutput1 = output.cast().map_err(|e| format!("DXGI-Ausgabe: {e}"))?;
        let dup = unsafe { output.DuplicateOutput(device) }.map_err(|e| format!("Desktop-Duplizierung: {e}"))?;
        let desc = unsafe { dup.GetDesc() };
        self.size = (desc.ModeDesc.Width, desc.ModeDesc.Height);
        self.dup = Some(dup);
        Ok(())
    }

    fn lost(&mut self, why: String) {
        if why != self.logged {
            crate::log(&format!("video: desktop duplication – {why}"));
            self.logged = why;
        }
        self.dup = None;
        self.retry_at = Instant::now() + RETRY;
    }

    /// The newest frame if the picture changed since the last call: our own copy (stays valid
    /// until the next call) and its size.
    pub fn frame(&mut self, device: &ID3D11Device, context: &ID3D11DeviceContext) -> Option<(ID3D11Texture2D, (u32, u32))> {
        if self.dup.is_none() {
            if Instant::now() < self.retry_at {
                return None;
            }
            if let Err(e) = self.open(device) {
                self.lost(e);
                return None;
            }
        }
        let dup = self.dup.clone()?;
        let mut info = DXGI_OUTDUPL_FRAME_INFO::default();
        let mut resource: Option<IDXGIResource> = None;
        match unsafe { dup.AcquireNextFrame(0, &mut info, &mut resource) } {
            Ok(()) => {}
            Err(e) if e.code() == DXGI_ERROR_WAIT_TIMEOUT => return None,
            // DXGI_ERROR_ACCESS_LOST (desktop switch, mode change, full-screen app) and the rest
            Err(e) => {
                self.lost(e.to_string());
                return None;
            }
        }
        let result = (|| {
            // only the mouse moved: no new picture
            if info.LastPresentTime == 0 {
                return None;
            }
            let texture: ID3D11Texture2D = resource.as_ref()?.cast().ok()?;
            let mut desc = D3D11_TEXTURE2D_DESC::default();
            unsafe { texture.GetDesc(&mut desc) };
            let fits = self.copy.as_ref().is_some_and(|c| {
                let mut have = D3D11_TEXTURE2D_DESC::default();
                unsafe { c.GetDesc(&mut have) };
                (have.Width, have.Height, have.Format) == (desc.Width, desc.Height, desc.Format)
            });
            if !fits {
                let own = D3D11_TEXTURE2D_DESC {
                    MipLevels: 1,
                    ArraySize: 1,
                    Usage: D3D11_USAGE_DEFAULT,
                    BindFlags: (D3D11_BIND_RENDER_TARGET.0 | D3D11_BIND_SHADER_RESOURCE.0) as u32,
                    CPUAccessFlags: 0,
                    MiscFlags: 0,
                    ..desc
                };
                let mut copy = None;
                unsafe { device.CreateTexture2D(&own, None, Some(&mut copy)) }.ok()?;
                self.copy = copy;
            }
            let copy = self.copy.clone()?;
            unsafe { context.CopyResource(&copy, &texture) };
            self.size = (desc.Width, desc.Height);
            Some((copy, self.size))
        })();
        drop(resource);
        if let Err(e) = unsafe { dup.ReleaseFrame() } {
            self.lost(e.to_string());
        }
        result
    }
}
