//! Wrong PINs per permanent room, across all viewers and kept across restarts: after
//! [`MAX_FAILURES`] the room is locked – no PIN tries, nobody gets in – until somebody unlocks it
//! on this computer (settings window, never over a connection). A right PIN starts counting afresh.
//! After every wrong PIN the next try waits a little longer (1 s, 2 s, … per failure so far).
//!
//! Stored in the app data folder (`pin_guard.json`, by room id).

use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::Mutex,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};

/// Wrong PINs (across all viewers) that lock a room.
pub const MAX_FAILURES: u32 = 10;

#[derive(Serialize, Deserialize, Default, Clone, Debug, PartialEq)]
pub struct Entry {
    /// wrong PINs since the last right one (or unlock)
    pub failures: u32,
    /// when the last wrong PIN came (unix ms) – for the waiting time
    #[serde(default)]
    pub last_failure: u64,
    /// locked since (unix ms)
    #[serde(default)]
    pub locked_at: Option<u64>,
}

impl Entry {
    pub fn locked(&self) -> bool {
        self.locked_at.is_some()
    }
}

/// Before checking a PIN.
#[derive(Debug, PartialEq)]
pub enum Gate {
    Open,
    /// too soon after the last wrong PIN: try again in this many seconds (not counted)
    Wait(u64),
    Locked,
}

/// After a wrong PIN.
#[derive(Debug, PartialEq)]
pub struct Failure {
    /// tries left before the room locks
    pub left: u32,
    /// seconds until the next try is taken
    pub wait: u64,
    /// this try locked the room
    pub locked_now: bool,
}

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

/// The waiting time after `failures` wrong PINs.
pub fn delay(failures: u32) -> Duration {
    Duration::from_secs(failures.min(MAX_FAILURES) as u64)
}

/// The counters of all rooms in one file.
pub struct Store {
    path: PathBuf,
}

impl Store {
    pub fn new(path: impl Into<PathBuf>) -> Store {
        Store { path: path.into() }
    }

    fn load(&self) -> HashMap<String, Entry> {
        std::fs::read(&self.path).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default()
    }

    fn save(&self, all: &HashMap<String, Entry>) {
        let write = || -> std::io::Result<()> {
            if let Some(dir) = self.path.parent() {
                std::fs::create_dir_all(dir)?;
            }
            // whole file or nothing: write aside, then replace
            let tmp = self.path.with_extension("json.tmp");
            std::fs::write(&tmp, serde_json::to_vec_pretty(all).unwrap_or_default())?;
            std::fs::rename(&tmp, &self.path)
        };
        if let Err(e) = write() {
            crate::log(&format!("pin_guard: {e}"));
        }
    }

    pub fn entry(&self, room: &str) -> Entry {
        self.load().remove(room).unwrap_or_default()
    }

    pub fn gate(&self, room: &str) -> Gate {
        let e = self.entry(room);
        if e.locked() {
            return Gate::Locked;
        }
        let ready = e.last_failure + delay(e.failures).as_millis() as u64;
        let now = now_ms();
        // a clock that went back never makes the wait longer than the delay itself
        match ready.checked_sub(now) {
            Some(ms) if ms > 0 => Gate::Wait(ms.min(delay(e.failures).as_millis() as u64).div_ceil(1000)),
            _ => Gate::Open,
        }
    }

    pub fn failure(&self, room: &str) -> Failure {
        let mut all = self.load();
        let e = all.entry(room.to_string()).or_default();
        if e.locked() {
            return Failure { left: 0, wait: 0, locked_now: false };
        }
        e.failures = (e.failures + 1).min(MAX_FAILURES);
        e.last_failure = now_ms();
        let locked_now = e.failures >= MAX_FAILURES;
        if locked_now {
            e.locked_at = Some(e.last_failure);
        }
        let result = Failure { left: MAX_FAILURES - e.failures, wait: if locked_now { 0 } else { delay(e.failures).as_secs() }, locked_now };
        self.save(&all);
        result
    }

    /// A right PIN: counting starts afresh (not for a locked room).
    pub fn success(&self, room: &str) {
        let mut all = self.load();
        if all.get(room).is_some_and(|e| !e.locked()) && all.remove(room).is_some() {
            self.save(&all);
        }
    }

    /// Unlocks the room and starts counting afresh – only from this computer's settings window.
    pub fn reset(&self, room: &str) {
        let mut all = self.load();
        if all.remove(room).is_some() {
            self.save(&all);
        }
    }
}

// ------------------------------------------------------------------ the app's store

static STORE: Mutex<Option<PathBuf>> = Mutex::new(None);
/// One change at a time (read, count, write).
static BUSY: Mutex<()> = Mutex::new(());
type OnLock = Box<dyn Fn(&str) + Send + Sync>;
static ON_LOCK: Mutex<Option<OnLock>> = Mutex::new(None);

/// Where the counters live (the app data folder) and what happens when a room locks.
pub fn init(path: &Path, on_lock: impl Fn(&str) + Send + Sync + 'static) {
    *STORE.lock().unwrap() = Some(path.to_path_buf());
    *ON_LOCK.lock().unwrap() = Some(Box::new(on_lock));
}

fn with<T>(f: impl FnOnce(&Store) -> T, fallback: T) -> T {
    let _busy = BUSY.lock().unwrap_or_else(|e| e.into_inner());
    let path = STORE.lock().unwrap().clone();
    match path {
        Some(p) => f(&Store::new(p)),
        None => fallback,
    }
}

pub fn entry(room: &str) -> Entry {
    with(|s| s.entry(room), Entry::default())
}

pub fn locked(room: &str) -> bool {
    entry(room).locked()
}

pub fn gate(room: &str) -> Gate {
    with(|s| s.gate(room), Gate::Open)
}

pub fn failure(room: &str) -> Failure {
    let f = with(|s| s.failure(room), Failure { left: MAX_FAILURES, wait: 0, locked_now: false });
    if f.locked_now {
        crate::log(&format!("pin_guard: room {room} locked after {MAX_FAILURES} wrong PINs"));
        if let Some(on_lock) = ON_LOCK.lock().unwrap().as_ref() {
            on_lock(room);
        }
    }
    f
}

pub fn success(room: &str) {
    with(|s| s.success(room), ())
}

pub fn reset(room: &str) {
    with(|s| s.reset(room), ())
}

#[cfg(test)]
pub(crate) fn init_for_tests() {
    let mut store = STORE.lock().unwrap();
    if store.is_none() {
        let dir = std::env::temp_dir().join(format!("peekaview-pin-guard-{}", std::process::id()));
        *store = Some(dir.join("pin_guard.json"));
    }
}

/// Pretends the waiting time after the last wrong PIN is over.
#[cfg(test)]
pub(crate) fn reset_wait_for_tests(room: &str) {
    with(
        |s| {
            let mut all = s.load();
            if let Some(e) = all.get_mut(room) {
                e.last_failure = 0;
                s.save(&all);
            }
        },
        (),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn store(name: &str) -> (Store, PathBuf) {
        let dir = std::env::temp_dir().join(format!("peekaview-pin-guard-test-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let path = dir.join("pin_guard.json");
        (Store::new(&path), path)
    }

    /// Pretends the waiting time is over.
    fn age(s: &Store, room: &str) {
        let mut all = s.load();
        all.get_mut(room).unwrap().last_failure = 0;
        s.save(&all);
    }

    #[test]
    fn counts_and_locks_after_ten() {
        let (s, _) = store("count");
        for i in 1..MAX_FAILURES {
            assert_eq!(s.gate("r"), Gate::Open);
            let f = s.failure("r");
            assert_eq!((f.left, f.wait, f.locked_now), (MAX_FAILURES - i, i as u64, false));
            age(&s, "r");
        }
        let last = s.failure("r");
        assert!(last.locked_now);
        assert_eq!(last.left, 0);
        assert_eq!(s.gate("r"), Gate::Locked);
        // further tries change nothing and do not lock again
        assert!(!s.failure("r").locked_now);
        // other rooms are not affected
        assert_eq!(s.gate("other"), Gate::Open);
    }

    #[test]
    fn right_pin_resets_but_not_a_locked_room() {
        let (s, _) = store("reset");
        for _ in 0..5 {
            s.failure("r");
        }
        s.success("r");
        assert_eq!(s.entry("r"), Entry::default());
        for _ in 0..MAX_FAILURES {
            s.failure("r");
        }
        s.success("r");
        assert!(s.entry("r").locked(), "a right PIN does not unlock");
    }

    #[test]
    fn waits_longer_after_every_failure() {
        let (s, _) = store("wait");
        s.failure("r");
        assert_eq!(s.gate("r"), Gate::Wait(1));
        age(&s, "r");
        s.failure("r");
        assert_eq!(s.gate("r"), Gate::Wait(2));
        age(&s, "r");
        assert_eq!(s.gate("r"), Gate::Open);
    }

    #[test]
    fn survives_a_restart() {
        let (s, path) = store("persist");
        for _ in 0..3 {
            s.failure("r");
        }
        assert_eq!(Store::new(&path).entry("r").failures, 3);
        for _ in 0..MAX_FAILURES {
            s.failure("r");
        }
        drop(s);
        let again = Store::new(&path);
        assert_eq!(again.gate("r"), Gate::Locked);
    }

    #[test]
    fn unlock_starts_afresh() {
        let (s, path) = store("unlock");
        for _ in 0..MAX_FAILURES {
            s.failure("r");
        }
        s.reset("r");
        let again = Store::new(&path);
        assert_eq!(again.gate("r"), Gate::Open);
        assert_eq!(again.entry("r"), Entry::default());
    }

    #[test]
    fn broken_file_counts_from_zero() {
        let (s, path) = store("broken");
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, b"{not json").unwrap();
        assert_eq!(s.gate("r"), Gate::Open);
        s.failure("r");
        assert_eq!(s.entry("r").failures, 1);
    }
}
