//! Restarting the Mac from afar. With FileVault on, a Mac stops after a restart at the FileVault
//! unlock, before any software runs – PeekaView too. `fdesetup authrestart` unlocks once without
//! that prompt; it needs the name and password of a user enabled for FileVault. The password
//! goes to fdesetup on stdin and nowhere else (no file, no log).

/// The `-inputplist` for `fdesetup authrestart`.
pub fn authrestart_plist(user: &str, password: &str) -> String {
    format!(
        "{}<dict>\n  <key>Username</key>\n  <string>{}</string>\n  <key>Password</key>\n  <string>{}</string>\n</dict>\n</plist>\n",
        r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
"#,
        super::xml_escape(user),
        super::xml_escape(password)
    )
}

/// A short user name as macOS allows it (no path or option tricks for fdesetup).
pub fn valid_user(user: &str) -> bool {
    (1..=64).contains(&user.len()) && !user.starts_with('-') && user.chars().all(|c| c.is_ascii_alphanumeric() || "._-".contains(c))
}

/// What to do for a restart request.
#[derive(Debug, PartialEq, Eq)]
pub enum Plan {
    /// plain restart (FileVault off, or no credentials – the Mac then waits at the unlock)
    Plain,
    /// arm an authenticated restart, then restart
    Auth { user: String, password: String },
}

pub fn plan(filevault: bool, user: Option<&str>, password: Option<&str>) -> Result<Plan, String> {
    match (filevault, user.map(str::trim).filter(|u| !u.is_empty()), password.filter(|p| !p.is_empty())) {
        (true, Some(user), Some(password)) => {
            if !valid_user(user) {
                return Err("Ungültiger Nutzername.".into());
            }
            if password.len() > 1024 {
                return Err("Das Passwort ist zu lang.".into());
            }
            Ok(Plan::Auth { user: user.into(), password: password.into() })
        }
        (true, Some(_), None) | (true, None, Some(_)) => Err("Bitte Nutzername und Passwort angeben – oder beides leer lassen.".into()),
        _ => Ok(Plan::Plain),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plist_escapes_the_password() {
        let p = authrestart_plist("anna", "a<b>&\"c</string><key>x");
        assert!(p.contains("<string>anna</string>"));
        assert!(p.contains("<string>a&lt;b&gt;&amp;&quot;c&lt;/string&gt;&lt;key&gt;x</string>"));
        assert_eq!(p.matches("<key>").count(), 2);
    }

    #[test]
    fn plans() {
        assert_eq!(plan(false, None, None), Ok(Plan::Plain));
        assert_eq!(plan(false, Some("anna"), Some("pw")), Ok(Plan::Plain), "without FileVault the password is not needed");
        assert_eq!(plan(true, None, None), Ok(Plan::Plain));
        assert_eq!(plan(true, Some(" anna "), Some("pw")), Ok(Plan::Auth { user: "anna".into(), password: "pw".into() }));
        assert!(plan(true, Some("anna"), None).is_err());
        assert!(plan(true, Some("-off"), Some("pw")).is_err());
        assert!(plan(true, Some("../x"), Some("pw")).is_err());
    }
}
