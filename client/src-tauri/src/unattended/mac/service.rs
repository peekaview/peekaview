//! The daemon (`--service`, root, LaunchDaemon): answers on the Unix socket, holds the links,
//! writes the access log and restarts the Mac. Capture and input are the agents' job.

use std::{
    io::Write,
    os::{
        fd::AsRawFd,
        unix::{fs::PermissionsExt, net::{UnixListener, UnixStream}},
    },
    process::{Command, Stdio},
    sync::{
        atomic::{AtomicU64, AtomicUsize, Ordering},
        Mutex,
    },
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use super::{
    super::{
        log,
        protocol::{self, Caller, Request, Response},
        store, VERSION,
    },
    peer,
    restart::{self, Plan},
    SOCKET,
};

const MAX_CLIENTS: usize = 8;
static CLIENTS: AtomicUsize = AtomicUsize::new(0);
/// when an agent last fetched the links (seconds since 1970)
static AGENT_SEEN: AtomicU64 = AtomicU64::new(0);

fn now() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

/// Entry for `--service`.
pub fn run() -> Result<(), String> {
    if !super::console::root() {
        return Err("the daemon must run as root".into());
    }
    // nothing the daemon creates is for others, unless set explicitly
    unsafe { libc::umask(0o077) };
    let _ = std::fs::remove_file(SOCKET);
    let listener = UnixListener::bind(SOCKET).map_err(|e| format!("{SOCKET}: {e}"))?;
    // everyone may connect (agents run as the signed-in user); every request is checked
    std::fs::set_permissions(SOCKET, std::fs::Permissions::from_mode(0o666)).map_err(|e| e.to_string())?;
    log::event("–", "–", &format!("Dienst gestartet ({} Links)", store::get().rooms.len()));
    for stream in listener.incoming() {
        let Ok(stream) = stream else { continue };
        if CLIENTS.load(Ordering::SeqCst) >= MAX_CLIENTS {
            continue;
        }
        CLIENTS.fetch_add(1, Ordering::SeqCst);
        std::thread::spawn(move || {
            serve(stream);
            CLIENTS.fetch_sub(1, Ordering::SeqCst);
        });
    }
    Ok(())
}

fn caller(stream: &UnixStream) -> Caller {
    let Ok(p) = peer::of(stream.as_raw_fd()) else { return Caller::default() };
    let installed = p.path().is_some_and(|path| path.starts_with(super::app_copy()));
    // the signature check is the expensive part: only when the rest fits
    let console = peer::console_uid();
    let agent = installed && console == Some(p.uid) && protocol::is_agent(p.signed_like_us(), installed, p.uid, console);
    Caller { root: p.uid == 0, agent }
}

fn serve(mut stream: UnixStream) {
    let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
    let _ = stream.set_write_timeout(Some(Duration::from_secs(5)));
    let request = protocol::read::<Request>(&mut stream);
    let response = match request {
        Ok(req) if !protocol::permitted(&req, caller(&stream)) => {
            crate::log(&format!("service socket: {req:?} not allowed"));
            Response::Error { message: "Nicht erlaubt.".into() }
        }
        Ok(Request::Status {}) => {
            let (filevault, authrestart) = filevault();
            Response::Status {
                version: VERSION.into(),
                helper: now().saturating_sub(AGENT_SEEN.load(Ordering::Relaxed)) < 20,
                session: 0,
                rooms: store::get().rooms.len() as u32,
                filevault,
                authrestart,
            }
        }
        Ok(Request::Reload {}) => {
            store::reload();
            Response::Ok {}
        }
        Ok(Request::Links {}) => {
            AGENT_SEEN.store(now(), Ordering::Relaxed);
            Response::Links { store: store::get() }
        }
        Ok(Request::Log { link, viewer, event }) => {
            log::event(&link, &viewer, &event);
            Response::Ok {}
        }
        Ok(Request::Restart { user, password }) => match restart(user.as_deref(), password.as_deref()) {
            Ok(()) => Response::Ok {},
            Err(message) => Response::Error { message },
        },
        Ok(Request::Sas {}) => Response::Error { message: "Nicht erlaubt.".into() },
        Err(e) => {
            crate::log(&format!("service socket: bad request ({e})"));
            Response::Error { message: "Ungültige Anfrage.".into() }
        }
    };
    let _ = protocol::write(&mut stream, &response);
}

fn fdesetup(arg: &str) -> bool {
    Command::new("/usr/bin/fdesetup").arg(arg).stderr(Stdio::null()).output().map(|o| String::from_utf8_lossy(&o.stdout).trim() == "true").unwrap_or(false)
}

/// (FileVault on, authenticated restart possible), asked at most once a minute.
fn filevault() -> (bool, bool) {
    static CACHE: Mutex<Option<(Instant, bool, bool)>> = Mutex::new(None);
    let mut cache = CACHE.lock().unwrap();
    if let Some((at, on, auth)) = *cache {
        if at.elapsed() < Duration::from_secs(60) {
            return (on, auth);
        }
    }
    let on = fdesetup("isactive");
    let auth = on && fdesetup("supportsauthrestart");
    *cache = Some((Instant::now(), on, auth));
    (on, auth)
}

fn restart(user: Option<&str>, password: Option<&str>) -> Result<(), String> {
    let (filevault, authrestart) = filevault();
    let plan = restart::plan(filevault, user, password)?;
    if let Plan::Auth { user, password } = &plan {
        if !authrestart {
            return Err("Dieser Mac kann nicht ohne FileVault-Abfrage neu starten.".into());
        }
        // arm it (-delayminutes -1: no restart yet) – a wrong password is reported to the viewer
        let mut child = Command::new("/usr/bin/fdesetup")
            .args(["authrestart", "-delayminutes", "-1", "-inputplist"])
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| e.to_string())?;
        if let Some(mut stdin) = child.stdin.take() {
            let _ = stdin.write_all(restart::authrestart_plist(user, password).as_bytes());
        }
        let ok = child.wait().map(|s| s.success()).unwrap_or(false);
        if !ok {
            log::event("–", "–", "Neustart ohne FileVault-Abfrage abgelehnt");
            return Err("FileVault hat Nutzername oder Passwort nicht angenommen.".into());
        }
    }
    log::event(
        "–",
        "–",
        match (&plan, filevault) {
            (Plan::Auth { .. }, _) => "Neustart (ohne FileVault-Abfrage)",
            (Plan::Plain, true) => "Neustart (FileVault-Passwort nötig)",
            (Plan::Plain, false) => "Neustart",
        },
    );
    // answer the agent first, then restart
    std::thread::spawn(|| {
        std::thread::sleep(Duration::from_secs(2));
        let _ = Command::new("/sbin/shutdown").args(["-r", "now"]).status();
    });
    Ok(())
}

