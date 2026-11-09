//! Talking to the service over its named pipe, and starting the elevated setup step.

use std::{fs::OpenOptions, os::windows::fs::OpenOptionsExt};

use windows_sys::Win32::{
    Foundation::{CloseHandle, WAIT_OBJECT_0},
    System::Threading::{GetExitCodeProcess, WaitForSingleObject, INFINITE},
    UI::{
        Shell::{ShellExecuteExW, SEE_MASK_NOCLOSEPROCESS, SHELLEXECUTEINFOW},
        WindowsAndMessaging::SW_HIDE,
    },
};

use super::{
    protocol::{self, Request, Response},
    Status, PIPE,
};

/// SECURITY_SQOS_PRESENT | SECURITY_IDENTIFICATION: the service may check who we are, but not act as us.
const SQOS_IDENTIFICATION: u32 = 0x0010_0000 | (1 << 16);

/// One request, one answer.
pub fn request(req: &Request) -> Result<Response, String> {
    let mut pipe = OpenOptions::new()
        .read(true)
        .write(true)
        .security_qos_flags(SQOS_IDENTIFICATION)
        .open(PIPE)
        .map_err(|e| format!("Der PeekaView-Dienst ist nicht erreichbar ({e})."))?;
    protocol::write(&mut pipe, req).map_err(|e| e.to_string())?;
    protocol::read(&mut pipe).map_err(|e| e.to_string())
}

pub fn status() -> Status {
    let installed = super::install::installed();
    match request(&Request::Status {}) {
        Ok(Response::Status { version, .. }) => Status { installed: true, running: true, version: Some(version) },
        _ => Status { installed, running: false, version: None },
    }
}

/// Strg+Alt+Entf through the service (only the SYSTEM helper is allowed to ask).
pub fn sas() -> Result<(), String> {
    match request(&Request::Sas {})? {
        Response::Ok {} => Ok(()),
        Response::Error { message } => Err(message),
        _ => Err("Unerwartete Antwort des Dienstes.".into()),
    }
}

fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

/// Quotes one argument for the Windows command line.
fn quote(arg: &str) -> String {
    if !arg.is_empty() && !arg.chars().any(|c| c == ' ' || c == '\t' || c == '"') {
        return arg.to_string();
    }
    let mut out = String::from('"');
    let mut slashes = 0;
    for c in arg.chars() {
        match c {
            '\\' => slashes += 1,
            '"' => {
                out.extend(std::iter::repeat_n('\\', slashes * 2 + 1));
                out.push('"');
                slashes = 0;
            }
            _ => {
                out.extend(std::iter::repeat_n('\\', slashes));
                out.push(c);
                slashes = 0;
            }
        }
    }
    out.extend(std::iter::repeat_n('\\', slashes * 2));
    out.push('"');
    out
}

/// Runs this program with `args` as administrator (UAC prompt) and waits for it.
pub fn elevate(args: &[String]) -> Result<(), String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let (verb, file) = (wide("runas"), wide(&exe.display().to_string()));
    let params = wide(&args.iter().map(|a| quote(a)).collect::<Vec<_>>().join(" "));
    let mut info: SHELLEXECUTEINFOW = unsafe { std::mem::zeroed() };
    info.cbSize = std::mem::size_of::<SHELLEXECUTEINFOW>() as u32;
    info.fMask = SEE_MASK_NOCLOSEPROCESS;
    info.lpVerb = verb.as_ptr();
    info.lpFile = file.as_ptr();
    info.lpParameters = params.as_ptr();
    info.nShow = SW_HIDE;
    if unsafe { ShellExecuteExW(&mut info) } == 0 || info.hProcess.is_null() {
        return Err("Ohne Administratorrechte lässt sich der Zugriff ohne Anmeldung nicht einrichten.".into());
    }
    let mut code = 1u32;
    unsafe {
        if WaitForSingleObject(info.hProcess, INFINITE) == WAIT_OBJECT_0 {
            GetExitCodeProcess(info.hProcess, &mut code);
        }
        CloseHandle(info.hProcess);
    }
    if code == 0 {
        Ok(())
    } else {
        Err("Der Windows-Dienst ließ sich nicht einrichten. Details stehen im PeekaView-Protokoll.".into())
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn quoting() {
        assert_eq!(super::quote("--helper"), "--helper");
        assert_eq!(super::quote(r"C:\Users\A B\AppData"), r#""C:\Users\A B\AppData""#);
        assert_eq!(super::quote(r"C:\dir with space\"), r#""C:\dir with space\\""#);
        assert_eq!(super::quote(r#"a"b"#), r#""a\"b""#);
    }
}
