//! Messages between the PeekaView service and its clients. Windows: a named pipe between the
//! service (LocalSystem), the helper in the console session and the user's app. macOS: a Unix socket
//! between the daemon (root), the agents (login window: root, user session: the user) and the app.
//!
//! Every message is a little-endian u32 length followed by that many bytes of JSON. Both sides
//! parse strictly: unknown message types and unknown fields are rejected, and nothing longer than
//! [`MAX`] is read – the pipe leads into a SYSTEM process.

use std::io::{self, Read, Write};

use serde::{de::DeserializeOwned, Deserialize, Serialize};

/// Largest message in either direction.
pub const MAX: usize = 64 * 1024;

/// What a client asks the service for.
#[derive(Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "t", rename_all = "kebab-case", deny_unknown_fields)]
pub enum Request {
    // struct variants (not unit variants): only these reject unknown fields when tagged
    /// Strg+Alt+Entf (secure attention sequence). Only the SYSTEM helper may ask for it.
    Sas {},
    /// Is the service running, which version, does a helper run in the console session?
    Status {},
    /// The links for access without sign-in changed (written by the elevated install step).
    Reload {},
    /// macOS: the links for the agent (it may run as a user who must not read the store file).
    /// Only for PeekaView itself (code signature checked).
    Links {},
    /// macOS: an entry for the access log (written by the daemon). Only for PeekaView itself.
    Log { link: String, viewer: String, event: String },
    /// macOS: restart the Mac; with a FileVault user's name and password as authenticated restart
    /// (`fdesetup authrestart`). Only for PeekaView itself. Never logged.
    Restart {
        #[serde(default)]
        user: Option<String>,
        #[serde(default)]
        password: Option<String>,
    },
}

#[derive(Serialize, Deserialize, Debug)]
#[serde(tag = "t", rename_all = "kebab-case", deny_unknown_fields)]
pub enum Response {
    Ok {},
    Error { message: String },
    Status {
        version: String,
        helper: bool,
        session: u32,
        rooms: u32,
        /// macOS: FileVault is on (after a restart the Mac waits for the password before anything runs)
        #[serde(default)]
        filevault: bool,
        /// macOS: `fdesetup authrestart` is possible
        #[serde(default)]
        authrestart: bool,
    },
    Links { store: super::store::Store },
}

impl std::fmt::Debug for Request {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        // never the password (a request may end up in an error message)
        match self {
            Request::Sas {} => f.write_str("Sas"),
            Request::Status {} => f.write_str("Status"),
            Request::Reload {} => f.write_str("Reload"),
            Request::Links {} => f.write_str("Links"),
            Request::Log { .. } => f.write_str("Log"),
            Request::Restart { user, password } => write!(f, "Restart {{ user: {}, password: {} }}", user.is_some(), password.is_some()),
        }
    }
}

#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
/// Who connects to the macOS daemon (checked on the socket, see `mac::peer`).
#[derive(Clone, Copy, Debug, Default)]
pub struct Caller {
    /// runs as root (the elevated setup step, or the agent at the login window)
    pub root: bool,
    /// PeekaView's agent for the session on the screen: signed like the daemon, the installed copy,
    /// and the user who owns the console
    pub agent: bool,
}

/// May `caller` make `req` of the macOS daemon? The links (with keys and PIN hashes), the log
/// and restarting are only for the agent on the screen; reloading only for root.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub fn permitted(req: &Request, caller: Caller) -> bool {
    match req {
        Request::Status {} => true,
        Request::Reload {} => caller.root,
        Request::Links {} | Request::Log { .. } | Request::Restart { .. } => caller.agent,
        // Strg+Alt+Entf does not exist on a Mac
        Request::Sas {} => false,
    }
}

/// Is a connecting process the agent on the screen? `signed`: its code signature satisfies the
/// daemon's own requirement; `installed`: it runs from the installed copy; `uid`/`console`: its
/// user and the owner of the console.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub fn is_agent(signed: bool, installed: bool, uid: u32, console: Option<u32>) -> bool {
    signed && installed && console == Some(uid)
}

/// The bytes of one message on the pipe.
pub fn encode<T: Serialize>(msg: &T) -> Vec<u8> {
    let body = serde_json::to_vec(msg).expect("serializable message");
    let mut out = Vec::with_capacity(body.len() + 4);
    out.extend_from_slice(&(body.len() as u32).to_le_bytes());
    out.extend_from_slice(&body);
    out
}

pub fn write<T: Serialize>(w: &mut impl Write, msg: &T) -> io::Result<()> {
    let bytes = encode(msg);
    if bytes.len() - 4 > MAX {
        return Err(io::Error::new(io::ErrorKind::InvalidInput, "message too long"));
    }
    w.write_all(&bytes)?;
    w.flush()
}

/// Reads one message; anything too long or malformed is an error (the connection is closed then).
pub fn read<T: DeserializeOwned>(r: &mut impl Read) -> io::Result<T> {
    let mut len = [0u8; 4];
    r.read_exact(&mut len)?;
    let len = u32::from_le_bytes(len) as usize;
    if len == 0 || len > MAX {
        return Err(io::Error::new(io::ErrorKind::InvalidData, "bad message length"));
    }
    let mut body = vec![0u8; len];
    r.read_exact(&mut body)?;
    serde_json::from_slice(&body).map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trip() {
        let log = Request::Log { link: "Büro".into(), viewer: "Anna".into(), event: "verbunden".into() };
        let restart = Request::Restart { user: Some("anna".into()), password: Some("geheim".into()) };
        for req in [Request::Sas {}, Request::Status {}, Request::Reload {}, Request::Links {}, log, restart] {
            let bytes = encode(&req);
            assert_eq!(u32::from_le_bytes(bytes[..4].try_into().unwrap()) as usize, bytes.len() - 4);
            assert_eq!(read::<Request>(&mut &bytes[..]).unwrap(), req);
        }
        let status = Response::Status { version: "2.0.0".into(), helper: true, session: 1, rooms: 2, filevault: true, authrestart: false };
        assert!(matches!(read::<Response>(&mut &encode(&status)[..]).unwrap(), Response::Status { filevault: true, rooms: 2, .. }));
        // an older service without the macOS fields
        let old = framed(r#"{"t":"status","version":"1","helper":false,"session":0,"rooms":0}"#);
        assert!(matches!(read::<Response>(&mut &old[..]).unwrap(), Response::Status { filevault: false, .. }));
        // a restart without credentials
        assert_eq!(read::<Request>(&mut &framed(r#"{"t":"restart"}"#)[..]).unwrap(), Request::Restart { user: None, password: None });
        assert_eq!(std::str::from_utf8(&encode(&Request::Sas {})[4..]).unwrap(), r#"{"t":"sas"}"#);
    }

    fn framed(json: &str) -> Vec<u8> {
        let mut out = (json.len() as u32).to_le_bytes().to_vec();
        out.extend_from_slice(json.as_bytes());
        out
    }

    #[test]
    fn rejects_unknown_types_and_fields() {
        assert!(read::<Request>(&mut &framed(r#"{"t":"exec","cmd":"calc"}"#)[..]).is_err());
        assert!(read::<Request>(&mut &framed(r#"{"t":"sas","session":2}"#)[..]).is_err());
        assert!(read::<Request>(&mut &framed(r#"{}"#)[..]).is_err());
        assert!(read::<Request>(&mut &framed(r#"not json"#)[..]).is_err());
        assert!(read::<Request>(&mut &framed(r#"{"t":"links","all":true}"#)[..]).is_err());
        assert!(read::<Request>(&mut &framed(r#"{"t":"restart","password":"x","cmd":"rm"}"#)[..]).is_err());
        assert!(read::<Request>(&mut &framed(r#"{"t":"log","link":"a","viewer":"b"}"#)[..]).is_err(), "missing field");
    }

    #[test]
    fn mac_daemon_rules() {
        let nobody = Caller::default();
        let root = Caller { root: true, agent: false };
        let agent = Caller { root: false, agent: true };
        let restart = Request::Restart { user: None, password: None };
        let log = Request::Log { link: String::new(), viewer: String::new(), event: String::new() };
        assert!(permitted(&Request::Status {}, nobody));
        for req in [&Request::Links {}, &log, &restart] {
            assert!(!permitted(req, nobody), "{req:?}");
            assert!(!permitted(req, root), "root alone is not the agent: {req:?}");
            assert!(permitted(req, agent), "{req:?}");
        }
        assert!(permitted(&Request::Reload {}, root));
        assert!(!permitted(&Request::Reload {}, agent));
        assert!(!permitted(&Request::Sas {}, Caller { root: true, agent: true }));
    }

    #[test]
    fn only_the_console_users_signed_agent() {
        assert!(is_agent(true, true, 501, Some(501)));
        assert!(is_agent(true, true, 0, Some(0)), "login window");
        assert!(!is_agent(true, true, 502, Some(501)), "another user's session (fast user switching)");
        assert!(!is_agent(false, true, 501, Some(501)), "not signed like the daemon");
        assert!(!is_agent(true, false, 501, Some(501)), "the app in /Applications, not the agent");
        assert!(!is_agent(true, true, 501, None));
    }

    #[test]
    fn passwords_stay_out_of_debug_output() {
        let s = format!("{:?}", Request::Restart { user: Some("anna".into()), password: Some("geheim".into()) });
        assert!(!s.contains("geheim") && !s.contains("anna"), "{s}");
    }

    #[test]
    fn rejects_bad_lengths() {
        let mut huge = ((MAX + 1) as u32).to_le_bytes().to_vec();
        huge.extend(std::iter::repeat_n(b' ', 16));
        assert!(read::<Request>(&mut &huge[..]).is_err());
        assert!(read::<Request>(&mut &0u32.to_le_bytes()[..]).is_err());
        // announced more than arrives
        let mut short = framed(r#"{"t":"sas"}"#);
        short.truncate(8);
        assert!(read::<Request>(&mut &short[..]).is_err());
    }
}
