//! Messages on the named pipe between the PeekaView service (LocalSystem) and its clients: the
//! helper in the console session and the user's PeekaView app.
//!
//! Every message is a little-endian u32 length followed by that many bytes of JSON. Both sides
//! parse strictly: unknown message types and unknown fields are rejected, and nothing longer than
//! [`MAX`] is read – the pipe leads into a SYSTEM process.

use std::io::{self, Read, Write};

use serde::{de::DeserializeOwned, Deserialize, Serialize};

/// Largest message in either direction.
pub const MAX: usize = 64 * 1024;

/// What a client asks the service for.
#[derive(Serialize, Deserialize, Debug, PartialEq, Eq)]
#[serde(tag = "t", rename_all = "kebab-case", deny_unknown_fields)]
pub enum Request {
    // struct variants (not unit variants): only these reject unknown fields when tagged
    /// Strg+Alt+Entf (secure attention sequence). Only the SYSTEM helper may ask for it.
    Sas {},
    /// Is the service running, which version, does a helper run in the console session?
    Status {},
    /// The links for access without sign-in changed (written by the elevated install step).
    Reload {},
}

#[derive(Serialize, Deserialize, Debug, PartialEq, Eq)]
#[serde(tag = "t", rename_all = "kebab-case", deny_unknown_fields)]
pub enum Response {
    Ok {},
    Error { message: String },
    Status { version: String, helper: bool, session: u32, rooms: u32 },
}

/// The bytes of one message on the pipe.
pub fn encode<T: Serialize>(msg: &T) -> Vec<u8> {
    let body = serde_json::to_vec(msg).expect("serializable message");
    let mut out = Vec::with_capacity(body.len() + 4);
    out.extend_from_slice(&(body.len() as u32).to_le_bytes());
    out.extend_from_slice(&body);
    out
}

#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
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
        for req in [Request::Sas {}, Request::Status {}, Request::Reload {}] {
            let bytes = encode(&req);
            assert_eq!(u32::from_le_bytes(bytes[..4].try_into().unwrap()) as usize, bytes.len() - 4);
            assert_eq!(read::<Request>(&mut &bytes[..]).unwrap(), req);
        }
        let status = Response::Status { version: "2.0.0".into(), helper: true, session: 1, rooms: 2 };
        assert_eq!(read::<Response>(&mut &encode(&status)[..]).unwrap(), status);
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
