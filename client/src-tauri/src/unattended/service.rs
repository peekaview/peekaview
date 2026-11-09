//! The PeekaView service (LocalSystem): keeps one helper running in the active console session,
//! answers on a named pipe and sends Strg+Alt+Entf for the helper.
//!
//! * The helper is this program with `--helper`, started with a copy of the service's own token
//!   moved into the console session (`TokenSessionId`), on `winsta0\default`. It follows the input
//!   desktop itself (Default ↔ Winlogon).
//! * A session change (sign-in with fast user switching, console connect/disconnect) moves the
//!   helper to the new console session. A helper that exits is started again with growing pauses.
//! * The pipe only lets SYSTEM, administrators and interactive users in, refuses remote clients
//!   and parses strictly (see `protocol`). Strg+Alt+Entf is only done for SYSTEM clients.

use std::{
    ffi::OsString,
    fs::File,
    os::windows::io::{AsRawHandle, FromRawHandle},
    sync::{
        atomic::{AtomicBool, AtomicU32, AtomicUsize, Ordering},
        mpsc, Mutex,
    },
    time::{Duration, Instant},
};

use windows_service::{
    define_windows_service,
    service::{ServiceControl, ServiceControlAccept, ServiceExitCode, ServiceState, ServiceStatus, ServiceType},
    service_control_handler::{self, ServiceControlHandlerResult},
    service_dispatcher,
};
use windows_sys::Win32::{
    Foundation::{CloseHandle, GetLastError, LocalFree, ERROR_PIPE_CONNECTED, HANDLE, INVALID_HANDLE_VALUE, WAIT_TIMEOUT},
    Security::{
        Authorization::{ConvertStringSecurityDescriptorToSecurityDescriptorW, SDDL_REVISION_1},
        DuplicateTokenEx, GetTokenInformation, IsWellKnownSid, RevertToSelf, SecurityIdentification, SetTokenInformation, TokenPrimary, TokenSessionId,
        TokenUser, WinLocalSystemSid, PSECURITY_DESCRIPTOR, SECURITY_ATTRIBUTES, TOKEN_ALL_ACCESS, TOKEN_QUERY, TOKEN_USER,
    },
    Storage::FileSystem::{FlushFileBuffers, PIPE_ACCESS_DUPLEX},
    System::{
        Environment::{CreateEnvironmentBlock, DestroyEnvironmentBlock},
        LibraryLoader::{GetProcAddress, LoadLibraryW},
        Pipes::{
            ConnectNamedPipe, CreateNamedPipeW, DisconnectNamedPipe, ImpersonateNamedPipeClient, PIPE_READMODE_BYTE, PIPE_REJECT_REMOTE_CLIENTS, PIPE_TYPE_BYTE,
            PIPE_UNLIMITED_INSTANCES, PIPE_WAIT,
        },
        RemoteDesktop::WTSGetActiveConsoleSessionId,
        Threading::{
            CreateProcessAsUserW, GetCurrentProcess, GetCurrentThread, OpenProcessToken, OpenThreadToken, TerminateProcess, WaitForSingleObject,
            CREATE_NO_WINDOW, CREATE_UNICODE_ENVIRONMENT, PROCESS_INFORMATION, STARTUPINFOW,
        },
    },
};

use super::{
    log,
    protocol::{self, Request, Response},
    store, PIPE, SERVICE_NAME, VERSION,
};

/// SYSTEM and administrators: everything; interactive users: read and write (status, reload).
const PIPE_SDDL: &str = "D:P(A;;GA;;;SY)(A;;GA;;;BA)(A;;GRGW;;;IU)";
/// pipe clients served at the same time (a client that never writes cannot block the rest)
const MAX_CLIENTS: usize = 8;
const NO_SESSION: u32 = 0xFFFF_FFFF;

static HELPER_SESSION: AtomicU32 = AtomicU32::new(NO_SESSION);
static HELPER_RUNNING: AtomicBool = AtomicBool::new(false);
static CLIENTS: AtomicUsize = AtomicUsize::new(0);
static EVENTS: Mutex<Option<mpsc::Sender<Event>>> = Mutex::new(None);

enum Event {
    Stop,
    /// the console session may have changed
    Session,
    /// the links changed: start the helper afresh
    Restart,
}

define_windows_service!(ffi_service_main, service_main);

/// Entry for `--service`: hands over to the service control manager.
pub fn run() -> Result<(), String> {
    service_dispatcher::start(SERVICE_NAME, ffi_service_main).map_err(|e| e.to_string())
}

fn service_main(_args: Vec<OsString>) {
    if let Err(e) = serve() {
        crate::log(&format!("service: {e}"));
    }
}

fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

fn serve() -> Result<(), String> {
    let (tx, rx) = mpsc::channel();
    *EVENTS.lock().unwrap() = Some(tx.clone());
    let status = service_control_handler::register(SERVICE_NAME, move |control| match control {
        ServiceControl::Stop | ServiceControl::Shutdown => {
            let _ = tx.send(Event::Stop);
            ServiceControlHandlerResult::NoError
        }
        ServiceControl::SessionChange(_) => {
            let _ = tx.send(Event::Session);
            ServiceControlHandlerResult::NoError
        }
        ServiceControl::Interrogate => ServiceControlHandlerResult::NoError,
        _ => ServiceControlHandlerResult::NotImplemented,
    })
    .map_err(|e| e.to_string())?;
    let set = |state: ServiceState, accept: ServiceControlAccept| {
        let _ = status.set_service_status(ServiceStatus {
            service_type: ServiceType::OWN_PROCESS,
            current_state: state,
            controls_accepted: accept,
            exit_code: ServiceExitCode::Win32(0),
            checkpoint: 0,
            wait_hint: Duration::default(),
            process_id: None,
        });
    };
    set(ServiceState::Running, ServiceControlAccept::STOP | ServiceControlAccept::SHUTDOWN | ServiceControlAccept::SESSION_CHANGE);
    log::event("–", "–", &format!("Dienst gestartet ({} Links)", store::get().rooms.len()));
    std::thread::spawn(pipe_server);

    let mut helper: Option<Helper> = None;
    let mut failures = 0u32;
    let mut next_start = Instant::now();
    loop {
        match rx.recv_timeout(Duration::from_secs(2)) {
            Ok(Event::Stop) => break,
            Ok(Event::Restart) => {
                if let Some(h) = helper.take() {
                    h.kill();
                }
                failures = 0;
                next_start = Instant::now();
            }
            Ok(Event::Session) | Err(_) => {}
        }
        let console = unsafe { WTSGetActiveConsoleSessionId() };
        if let Some(h) = &helper {
            let alive = h.alive();
            if h.session != console || !alive {
                if !alive {
                    failures += 1;
                    crate::log(&format!("service: helper in session {} exited", h.session));
                }
                if let Some(h) = helper.take() {
                    h.kill();
                }
            } else if failures > 0 && h.started.elapsed() > Duration::from_secs(60) {
                failures = 0;
            }
        }
        let wanted = !store::get().rooms.is_empty();
        if helper.is_none() && wanted && console != NO_SESSION && Instant::now() >= next_start {
            match Helper::spawn(console) {
                Ok(h) => {
                    crate::log(&format!("service: helper started in session {console}"));
                    helper = Some(h);
                }
                Err(e) => {
                    failures += 1;
                    crate::log(&format!("service: cannot start the helper: {e}"));
                }
            }
            next_start = Instant::now() + super::backoff(failures);
        }
        if !wanted {
            if let Some(h) = helper.take() {
                h.kill();
            }
        }
        HELPER_RUNNING.store(helper.is_some(), Ordering::Relaxed);
        HELPER_SESSION.store(helper.as_ref().map(|h| h.session).unwrap_or(NO_SESSION), Ordering::Relaxed);
    }
    if let Some(h) = helper.take() {
        h.kill();
    }
    log::event("–", "–", "Dienst beendet");
    set(ServiceState::Stopped, ServiceControlAccept::empty());
    Ok(())
}

// ------------------------------------------------------------------ the helper process

struct Helper {
    process: HANDLE,
    session: u32,
    started: Instant,
}

impl Helper {
    /// This program with `--helper`, as SYSTEM in `session`.
    fn spawn(session: u32) -> Result<Helper, String> {
        let exe = std::env::current_exe().map_err(|e| e.to_string())?;
        let mut cmd = wide(&format!("\"{}\" --helper", exe.display()));
        let mut desktop = wide(r"winsta0\default");
        unsafe {
            let mut own: HANDLE = std::ptr::null_mut();
            if OpenProcessToken(GetCurrentProcess(), TOKEN_ALL_ACCESS, &mut own) == 0 {
                return Err(format!("OpenProcessToken {}", GetLastError()));
            }
            let mut token: HANDLE = std::ptr::null_mut();
            let dup = DuplicateTokenEx(own, TOKEN_ALL_ACCESS, std::ptr::null(), SecurityIdentification, TokenPrimary, &mut token);
            CloseHandle(own);
            if dup == 0 {
                return Err(format!("DuplicateTokenEx {}", GetLastError()));
            }
            let close = |token: HANDLE| CloseHandle(token);
            if SetTokenInformation(token, TokenSessionId, (&session as *const u32).cast(), 4) == 0 {
                let e = GetLastError();
                close(token);
                return Err(format!("SetTokenInformation {e}"));
            }
            let mut env: *mut core::ffi::c_void = std::ptr::null_mut();
            if CreateEnvironmentBlock(&mut env, token, 0) == 0 {
                env = std::ptr::null_mut();
            }
            let mut si: STARTUPINFOW = std::mem::zeroed();
            si.cb = std::mem::size_of::<STARTUPINFOW>() as u32;
            si.lpDesktop = desktop.as_mut_ptr();
            let mut pi: PROCESS_INFORMATION = std::mem::zeroed();
            let ok = CreateProcessAsUserW(
                token,
                std::ptr::null(),
                cmd.as_mut_ptr(),
                std::ptr::null(),
                std::ptr::null(),
                0,
                CREATE_UNICODE_ENVIRONMENT | CREATE_NO_WINDOW,
                env,
                std::ptr::null(),
                &si,
                &mut pi,
            );
            let error = GetLastError();
            if !env.is_null() {
                DestroyEnvironmentBlock(env);
            }
            close(token);
            if ok == 0 {
                return Err(format!("CreateProcessAsUser {error}"));
            }
            CloseHandle(pi.hThread);
            Ok(Helper { process: pi.hProcess, session, started: Instant::now() })
        }
    }

    fn alive(&self) -> bool {
        unsafe { WaitForSingleObject(self.process, 0) == WAIT_TIMEOUT }
    }

    fn kill(self) {
        unsafe {
            if self.alive() {
                TerminateProcess(self.process, 0);
            }
            CloseHandle(self.process);
        }
    }
}

// ------------------------------------------------------------------ named pipe

struct Security(PSECURITY_DESCRIPTOR);

impl Security {
    fn new() -> Result<Security, String> {
        let mut sd: PSECURITY_DESCRIPTOR = std::ptr::null_mut();
        let sddl = wide(PIPE_SDDL);
        if unsafe { ConvertStringSecurityDescriptorToSecurityDescriptorW(sddl.as_ptr(), SDDL_REVISION_1, &mut sd, std::ptr::null_mut()) } == 0 {
            return Err(format!("security descriptor {}", unsafe { GetLastError() }));
        }
        Ok(Security(sd))
    }
}

impl Drop for Security {
    fn drop(&mut self) {
        unsafe { LocalFree(self.0) };
    }
}

fn pipe_server() {
    let security = match Security::new() {
        Ok(s) => s,
        Err(e) => {
            crate::log(&format!("service pipe: {e}"));
            return;
        }
    };
    let name = wide(PIPE);
    loop {
        let sa = SECURITY_ATTRIBUTES { nLength: std::mem::size_of::<SECURITY_ATTRIBUTES>() as u32, lpSecurityDescriptor: security.0, bInheritHandle: 0 };
        let pipe = unsafe {
            CreateNamedPipeW(
                name.as_ptr(),
                PIPE_ACCESS_DUPLEX,
                PIPE_TYPE_BYTE | PIPE_READMODE_BYTE | PIPE_WAIT | PIPE_REJECT_REMOTE_CLIENTS,
                PIPE_UNLIMITED_INSTANCES,
                protocol::MAX as u32,
                protocol::MAX as u32,
                0,
                &sa,
            )
        };
        if pipe == INVALID_HANDLE_VALUE {
            crate::log(&format!("service pipe: create {}", unsafe { GetLastError() }));
            std::thread::sleep(Duration::from_secs(1));
            continue;
        }
        let connected = unsafe { ConnectNamedPipe(pipe, std::ptr::null_mut()) } != 0 || unsafe { GetLastError() } == ERROR_PIPE_CONNECTED;
        if !connected || CLIENTS.load(Ordering::SeqCst) >= MAX_CLIENTS {
            unsafe {
                DisconnectNamedPipe(pipe);
                CloseHandle(pipe);
            }
            continue;
        }
        CLIENTS.fetch_add(1, Ordering::SeqCst);
        let raw = pipe as usize;
        std::thread::spawn(move || {
            serve_client(raw as HANDLE);
            CLIENTS.fetch_sub(1, Ordering::SeqCst);
        });
    }
}

/// Is the client on the other end of `pipe` LocalSystem? (after it has written something)
fn client_is_system(pipe: HANDLE) -> bool {
    unsafe {
        if ImpersonateNamedPipeClient(pipe) == 0 {
            return false;
        }
        let mut token: HANDLE = std::ptr::null_mut();
        let opened = OpenThreadToken(GetCurrentThread(), TOKEN_QUERY, 1, &mut token) != 0;
        RevertToSelf();
        if !opened {
            return false;
        }
        let mut buf = [0u8; 256];
        let mut len = 0u32;
        let ok = GetTokenInformation(token, TokenUser, buf.as_mut_ptr().cast(), buf.len() as u32, &mut len) != 0;
        CloseHandle(token);
        if !ok {
            return false;
        }
        let user = &*(buf.as_ptr() as *const TOKEN_USER);
        IsWellKnownSid(user.User.Sid, WinLocalSystemSid) != 0
    }
}

fn serve_client(pipe: HANDLE) {
    // SAFETY: the handle belongs to this thread from here on; the File closes it
    let mut file = unsafe { File::from_raw_handle(pipe as _) };
    let request = protocol::read::<Request>(&mut file);
    let response = match request {
        Ok(Request::Status {}) => Response::Status {
            version: VERSION.into(),
            helper: HELPER_RUNNING.load(Ordering::Relaxed),
            session: HELPER_SESSION.load(Ordering::Relaxed),
            rooms: store::get().rooms.len() as u32,
        },
        Ok(Request::Reload {}) => {
            store::reload();
            if let Some(tx) = EVENTS.lock().unwrap().as_ref() {
                let _ = tx.send(Event::Restart);
            }
            Response::Ok {}
        }
        Ok(Request::Sas {}) if client_is_system(pipe) => match send_sas() {
            Ok(()) => Response::Ok {},
            Err(message) => Response::Error { message },
        },
        Ok(Request::Sas {}) => Response::Error { message: "Nicht erlaubt.".into() },
        Err(e) => {
            crate::log(&format!("service pipe: bad request ({e})"));
            Response::Error { message: "Ungültige Anfrage.".into() }
        }
    };
    let _ = protocol::write(&mut file, &response);
    unsafe {
        FlushFileBuffers(file.as_raw_handle() as HANDLE);
        DisconnectNamedPipe(file.as_raw_handle() as HANDLE);
    }
}

/// Strg+Alt+Entf (sas.dll). Needs the policy SoftwareSASGeneration, set by the install step.
fn send_sas() -> Result<(), String> {
    type SendSas = unsafe extern "system" fn(i32);
    unsafe {
        let lib = LoadLibraryW(wide("sas.dll").as_ptr());
        if lib.is_null() {
            return Err("sas.dll fehlt.".into());
        }
        let Some(f) = GetProcAddress(lib, c"SendSAS".as_ptr().cast()) else {
            return Err("SendSAS fehlt.".into());
        };
        let send: SendSas = std::mem::transmute(f);
        // FALSE: called from a service
        send(0);
    }
    log::event("–", "–", "Strg+Alt+Entf gesendet");
    Ok(())
}
