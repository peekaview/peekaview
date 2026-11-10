//! Special key combinations from the viewer's "Sondertasten" menu. Only the names listed here are
//! accepted; anything else from the network is dropped.

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum K {
    Ctrl,
    Alt,
    Shift,
    /// Windows key / ⌘
    Meta,
    Tab,
    F4,
    Escape,
    Space,
    Q,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Action {
    /// Strg+Alt+Entf – only the service can send it (SendSAS)
    Sas,
    /// lock the workstation (Windows: LockWorkStation)
    Lock,
    /// macOS: lock the screen – Ctrl+Cmd+Q, if that does not lock: login.framework
    MacLock,
    /// press these keys in order, release them in reverse
    Keys(Vec<K>),
}

/// The action for a menu entry `k` on a host running macOS (`mac`) or Windows/Linux.
pub fn parse(k: &str, mac: bool) -> Option<Action> {
    use K::*;
    Some(match (k, mac) {
        ("cad", false) => Action::Sas,
        ("lock", false) => Action::Lock,
        ("lock", true) => Action::MacLock,
        ("win", false) => Action::Keys(vec![Meta]),
        ("alt-tab", false) => Action::Keys(vec![Alt, Tab]),
        ("alt-f4", false) => Action::Keys(vec![Alt, F4]),
        ("ctrl-shift-esc", false) => Action::Keys(vec![Ctrl, Shift, Escape]),
        ("cmd-tab", true) => Action::Keys(vec![Meta, Tab]),
        ("cmd-space", true) => Action::Keys(vec![Meta, Space]),
        ("cmd-q", true) => Action::Keys(vec![Meta, Q]),
        ("force-quit", true) => Action::Keys(vec![Meta, Alt, Escape]),
        _ => return None,
    })
}

/// How the action is named in the access log and in messages to the viewer.
pub fn label(k: &str) -> &'static str {
    match k {
        "cad" => "Strg+Alt+Entf",
        "lock" => "Sperren",
        "win" => "Windows-Taste",
        "alt-tab" => "Alt+Tab",
        "alt-f4" => "Alt+F4",
        "ctrl-shift-esc" => "Strg+Umschalt+Esc",
        "cmd-tab" => "Cmd+Tab",
        "cmd-space" => "Cmd+Leertaste",
        "cmd-q" => "Cmd+Q",
        "force-quit" => "Sofort beenden",
        _ => "unbekannt",
    }
}

#[cfg(test)]
mod tests {
    use super::{Action, K::*, *};

    #[test]
    fn windows_entries() {
        assert_eq!(parse("cad", false), Some(Action::Sas));
        assert_eq!(parse("lock", false), Some(Action::Lock));
        assert_eq!(parse("win", false), Some(Action::Keys(vec![Meta])));
        assert_eq!(parse("alt-tab", false), Some(Action::Keys(vec![Alt, Tab])));
        assert_eq!(parse("alt-f4", false), Some(Action::Keys(vec![Alt, F4])));
        assert_eq!(parse("ctrl-shift-esc", false), Some(Action::Keys(vec![Ctrl, Shift, Escape])));
        assert_eq!(parse("cmd-tab", false), None, "a Mac entry on Windows");
    }

    #[test]
    fn mac_entries() {
        assert_eq!(parse("cmd-tab", true), Some(Action::Keys(vec![Meta, Tab])));
        assert_eq!(parse("cmd-space", true), Some(Action::Keys(vec![Meta, Space])));
        assert_eq!(parse("lock", true), Some(Action::MacLock));
        assert_eq!(parse("cmd-q", true), Some(Action::Keys(vec![Meta, Q])));
        assert_eq!(parse("force-quit", true), Some(Action::Keys(vec![Meta, Alt, Escape])));
        assert_eq!(parse("force-quit", false), None, "a Mac entry on Windows");
        assert_eq!(label("force-quit"), "Sofort beenden");
        assert_eq!(parse("cad", true), None, "no Strg+Alt+Entf on a Mac");
    }

    #[test]
    fn unknown_names_are_dropped() {
        for k in ["", "CAD", "cad ", "shutdown", "alt+tab", "\u{0}"] {
            assert_eq!(parse(k, false), None, "{k:?}");
            assert_eq!(parse(k, true), None, "{k:?}");
        }
        assert_eq!(label("rm -rf"), "unbekannt");
        assert_eq!(label("cad"), "Strg+Alt+Entf");
    }
}
