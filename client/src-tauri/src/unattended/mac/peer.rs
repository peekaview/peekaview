//! Who is on the other end of the daemon's socket: user id, process, and whether it is PeekaView
//! itself – checked by the code signature of the connecting process (its audit token), against the
//! daemon's own designated requirement. A Developer ID build accepts only code from the same team
//! with the same bundle id; an ad-hoc build only the very same binary (cdhash).

use std::{
    os::fd::RawFd,
    path::PathBuf,
    sync::OnceLock,
};

use super::cf::{kCFTypeDictionaryKeyCallBacks, kCFTypeDictionaryValueCallBacks, CFDataCreate, CFDictionaryCreate, CFTypeRef, Owned};

const SOL_LOCAL: i32 = 0;
const LOCAL_PEERTOKEN: i32 = 6;

#[link(name = "Security", kind = "framework")]
extern "C" {
    static kSecGuestAttributeAudit: CFTypeRef;
    fn SecCodeCopySelf(flags: u32, code: *mut CFTypeRef) -> i32;
    fn SecCodeCopyStaticCode(code: CFTypeRef, flags: u32, static_code: *mut CFTypeRef) -> i32;
    fn SecCodeCopyDesignatedRequirement(code: CFTypeRef, flags: u32, requirement: *mut CFTypeRef) -> i32;
    fn SecCodeCopyGuestWithAttributes(host: CFTypeRef, attributes: CFTypeRef, flags: u32, guest: *mut CFTypeRef) -> i32;
    fn SecCodeCheckValidity(code: CFTypeRef, flags: u32, requirement: CFTypeRef) -> i32;
}

#[derive(Clone, Debug)]
pub struct Peer {
    pub uid: u32,
    pub pid: i32,
    token: [u32; 8],
}

/// The peer of a connected Unix socket.
pub fn of(fd: RawFd) -> std::io::Result<Peer> {
    let mut token = [0u32; 8];
    let mut len = std::mem::size_of_val(&token) as libc::socklen_t;
    if unsafe { libc::getsockopt(fd, SOL_LOCAL, LOCAL_PEERTOKEN, token.as_mut_ptr().cast(), &mut len) } != 0 {
        return Err(std::io::Error::last_os_error());
    }
    // audit_token_t: [auid, euid, egid, ruid, rgid, pid, asid, pidversion]
    Ok(Peer { uid: token[1], pid: token[5] as i32, token })
}

/// The daemon's own designated requirement (kept for the life of the process).
fn own_requirement() -> Option<usize> {
    static REQ: OnceLock<Option<usize>> = OnceLock::new();
    *REQ.get_or_init(|| unsafe {
        let mut me: CFTypeRef = std::ptr::null();
        if SecCodeCopySelf(0, &mut me) != 0 {
            return None;
        }
        let me = Owned::new(me)?;
        let mut stat: CFTypeRef = std::ptr::null();
        if SecCodeCopyStaticCode(me.0, 0, &mut stat) != 0 {
            return None;
        }
        let stat = Owned::new(stat)?;
        let mut req: CFTypeRef = std::ptr::null();
        if SecCodeCopyDesignatedRequirement(stat.0, 0, &mut req) != 0 || req.is_null() {
            return None;
        }
        // deliberately leaked: used for every connection
        Some(req as usize)
    })
}

impl Peer {
    /// Is the process PeekaView, signed like the daemon? (by audit token: no pid reuse race)
    pub fn signed_like_us(&self) -> bool {
        let Some(req) = own_requirement() else { return false };
        unsafe {
            let data = Owned::new(CFDataCreate(std::ptr::null(), self.token.as_ptr().cast(), 32));
            let Some(data) = data else { return false };
            let keys = [kSecGuestAttributeAudit];
            let values = [data.0];
            let attrs = Owned::new(CFDictionaryCreate(
                std::ptr::null(),
                keys.as_ptr(),
                values.as_ptr(),
                1,
                &kCFTypeDictionaryKeyCallBacks,
                &kCFTypeDictionaryValueCallBacks,
            ));
            let Some(attrs) = attrs else { return false };
            let mut code: CFTypeRef = std::ptr::null();
            if SecCodeCopyGuestWithAttributes(std::ptr::null(), attrs.0, 0, &mut code) != 0 {
                return false;
            }
            let Some(code) = Owned::new(code) else { return false };
            SecCodeCheckValidity(code.0, 0, req as CFTypeRef) == 0
        }
    }

    /// The executable of the process.
    pub fn path(&self) -> Option<PathBuf> {
        let mut buf = vec![0u8; libc::PROC_PIDPATHINFO_MAXSIZE as usize];
        let n = unsafe { libc::proc_pidpath(self.pid, buf.as_mut_ptr().cast(), buf.len() as u32) };
        (n > 0).then(|| PathBuf::from(String::from_utf8_lossy(&buf[..n as usize]).into_owned()))
    }
}

/// Owner of /dev/console: the user on the screen (root at the login window).
pub fn console_uid() -> Option<u32> {
    use std::os::unix::fs::MetadataExt;
    std::fs::metadata("/dev/console").ok().map(|m| m.uid())
}

#[cfg(test)]
mod tests {
    use std::os::{fd::AsRawFd, unix::net::UnixStream};

    #[test]
    fn peer_of_a_socket_is_known_and_signed_like_us() {
        let (a, _b) = UnixStream::pair().unwrap();
        let p = super::of(a.as_raw_fd()).unwrap();
        assert_eq!(p.uid, unsafe { libc::geteuid() });
        assert_eq!(p.pid, std::process::id() as i32);
        assert_eq!(p.path().unwrap(), std::env::current_exe().unwrap().canonicalize().unwrap());
        // the test binary checks itself against its own designated requirement
        assert!(p.signed_like_us(), "own code must satisfy own requirement");
    }

    #[test]
    fn another_program_is_not_signed_like_us() {
        let dir = std::env::temp_dir().join(format!("pv-peer-{}", std::process::id()));
        let _ = std::fs::create_dir_all(&dir);
        let path = dir.join("s.sock");
        let _ = std::fs::remove_file(&path);
        let listener = std::os::unix::net::UnixListener::bind(&path).unwrap();
        // Apple's nc connects (signed by Apple, not by us)
        let mut child = std::process::Command::new("/usr/bin/nc").arg("-U").arg(&path).stdin(std::process::Stdio::piped()).stdout(std::process::Stdio::null()).spawn().unwrap();
        let (stream, _) = listener.accept().unwrap();
        let p = super::of(stream.as_raw_fd()).unwrap();
        assert_eq!(p.pid, child.id() as i32);
        assert!(!p.signed_like_us(), "nc must not pass as PeekaView");
        assert_eq!(p.path().unwrap(), std::path::PathBuf::from("/usr/bin/nc"));
        let _ = child.kill();
        let _ = std::fs::remove_dir_all(&dir);
    }
}
