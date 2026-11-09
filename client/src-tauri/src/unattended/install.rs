//! The elevated setup step (`--install-service <app data dir>` / `--uninstall-service`), started by
//! the app with a UAC prompt.
//!
//! The service must not run from the user's folder (the per-user install in %LOCALAPPDATA%): a
//! user could swap the exe and get code running as SYSTEM. So the step copies this exe to
//! `%ProgramFiles%\PeekaView\Dienst\`, where only administrators may write.

use std::{
    ffi::OsString,
    path::{Path, PathBuf},
    time::{Duration, Instant},
};

use serde_json::Value;
use windows_service::{
    service::{
        ServiceAccess, ServiceAction, ServiceActionType, ServiceErrorControl, ServiceFailureActions, ServiceFailureResetPeriod, ServiceInfo, ServiceStartType,
        ServiceState, ServiceType,
    },
    service_manager::{ServiceManager, ServiceManagerAccess},
};
use windows_sys::Win32::{
    Foundation::LocalFree,
    Security::{
        Authorization::{ConvertStringSecurityDescriptorToSecurityDescriptorW, SDDL_REVISION_1},
        SetFileSecurityW, DACL_SECURITY_INFORMATION, PROTECTED_DACL_SECURITY_INFORMATION, PSECURITY_DESCRIPTOR,
    },
    System::Registry::{RegDeleteKeyValueW, RegSetKeyValueW, HKEY_LOCAL_MACHINE, REG_DWORD},
};

use super::{data_dir, log, protocol::Request, store, SERVICE_DISPLAY, SERVICE_NAME};

/// Only SYSTEM and administrators, nothing inherited from ProgramData (where users may read).
const DATA_SDDL: &str = "D:P(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)";
const POLICY_KEY: &str = r"SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System";
/// 1 = services may generate Strg+Alt+Entf (SendSAS)
const SAS_VALUE: &str = "SoftwareSASGeneration";

fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

fn service_dir() -> PathBuf {
    PathBuf::from(std::env::var("ProgramFiles").unwrap_or_else(|_| r"C:\Program Files".into())).join("PeekaView").join("Dienst")
}

/// Is the service set up? (Anybody may ask.)
pub fn installed() -> bool {
    ServiceManager::local_computer(None::<&str>, ServiceManagerAccess::CONNECT)
        .and_then(|m| m.open_service(SERVICE_NAME, ServiceAccess::QUERY_STATUS))
        .is_ok()
}

/// The links of the user's app (rooms.json and settings.json in `dir`) → the service's store.
fn read_links(dir: &Path) -> Result<store::Store, String> {
    let rooms: Vec<crate::rooms::Room> = serde_json::from_slice(&std::fs::read(dir.join("rooms.json")).map_err(|e| format!("rooms.json: {e}"))?).map_err(|e| e.to_string())?;
    let settings: Value = std::fs::read(dir.join("settings.json")).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default();
    let relays: Vec<String> = match &settings["relays"] {
        Value::Array(a) => a.iter().filter_map(|v| v.as_str().map(str::to_string)).collect(),
        Value::String(s) => s.split_whitespace().map(str::to_string).collect(),
        _ => vec![],
    };
    let name = settings["name"].as_str().map(str::to_string).or_else(|| std::env::var("COMPUTERNAME").ok()).unwrap_or_default();
    Ok(store::sanitize(&name, &relays, rooms))
}

fn secure_dir(dir: &Path) -> Result<(), String> {
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    unsafe {
        let mut sd: PSECURITY_DESCRIPTOR = std::ptr::null_mut();
        if ConvertStringSecurityDescriptorToSecurityDescriptorW(wide(DATA_SDDL).as_ptr(), SDDL_REVISION_1, &mut sd, std::ptr::null_mut()) == 0 {
            return Err("security descriptor".into());
        }
        let ok = SetFileSecurityW(wide(&dir.display().to_string()).as_ptr(), DACL_SECURITY_INFORMATION | PROTECTED_DACL_SECURITY_INFORMATION, sd);
        LocalFree(sd);
        if ok == 0 {
            return Err(format!("{}: Zugriffsrechte nicht gesetzt", dir.display()));
        }
    }
    Ok(())
}

fn write_store(s: &store::Store) -> Result<(), String> {
    let path = store::path();
    let tmp = path.with_extension("tmp");
    std::fs::write(&tmp, serde_json::to_vec_pretty(s).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &path).map_err(|e| e.to_string())
}

fn set_sas_policy(on: bool) {
    let (key, value) = (wide(POLICY_KEY), wide(SAS_VALUE));
    unsafe {
        if on {
            let one = 1u32;
            RegSetKeyValueW(HKEY_LOCAL_MACHINE, key.as_ptr(), value.as_ptr(), REG_DWORD, (&one as *const u32).cast(), 4);
        } else {
            RegDeleteKeyValueW(HKEY_LOCAL_MACHINE, key.as_ptr(), value.as_ptr());
        }
    }
}

/// Stops the service (if it runs) and waits until it did.
fn stop(manager: &ServiceManager) {
    let Ok(service) = manager.open_service(SERVICE_NAME, ServiceAccess::STOP | ServiceAccess::QUERY_STATUS) else { return };
    let _ = service.stop();
    let start = Instant::now();
    while start.elapsed() < Duration::from_secs(15) {
        if service.query_status().map(|s| s.current_state == ServiceState::Stopped).unwrap_or(true) {
            return;
        }
        std::thread::sleep(Duration::from_millis(300));
    }
}

/// `--install-service <dir>`: installs or updates the service with the links marked
/// "Auch ohne Anmeldung" in the user's app data `dir`.
pub fn install(dir: &Path) -> Result<(), String> {
    let links = read_links(dir)?;
    if links.rooms.is_empty() {
        return uninstall();
    }
    let manager = ServiceManager::local_computer(None::<&str>, ServiceManagerAccess::CONNECT | ServiceManagerAccess::CREATE_SERVICE).map_err(|e| e.to_string())?;
    stop(&manager);

    secure_dir(&data_dir())?;
    write_store(&links)?;

    let target_dir = service_dir();
    std::fs::create_dir_all(&target_dir).map_err(|e| e.to_string())?;
    let target = target_dir.join("peekaview.exe");
    let source = std::env::current_exe().map_err(|e| e.to_string())?;
    // the stopped service may hold the file a moment longer
    let mut copied = Err(String::new());
    for _ in 0..20 {
        copied = std::fs::copy(&source, &target).map(|_| ()).map_err(|e| format!("{}: {e}", target.display()));
        if copied.is_ok() {
            break;
        }
        std::thread::sleep(Duration::from_millis(250));
    }
    copied?;
    set_sas_policy(true);

    let info = ServiceInfo {
        name: OsString::from(SERVICE_NAME),
        display_name: OsString::from(SERVICE_DISPLAY),
        service_type: ServiceType::OWN_PROCESS,
        start_type: ServiceStartType::AutoStart,
        error_control: ServiceErrorControl::Normal,
        executable_path: target,
        launch_arguments: vec![OsString::from("--service")],
        dependencies: vec![],
        account_name: None,
        account_password: None,
    };
    let access = ServiceAccess::QUERY_STATUS | ServiceAccess::START | ServiceAccess::CHANGE_CONFIG;
    let service = match manager.open_service(SERVICE_NAME, access) {
        Ok(s) => {
            s.change_config(&info).map_err(|e| e.to_string())?;
            s
        }
        Err(_) => manager.create_service(&info, access).map_err(|e| e.to_string())?,
    };
    let _ = service.set_description("Hält feste PeekaView-Links mit Fernzugriff auch am Anmeldebildschirm erreichbar.");
    let restart = |secs| ServiceAction { action_type: ServiceActionType::Restart, delay: Duration::from_secs(secs) };
    let _ = service.update_failure_actions(ServiceFailureActions {
        reset_period: ServiceFailureResetPeriod::After(Duration::from_secs(86_400)),
        reboot_msg: None,
        command: None,
        actions: Some(vec![restart(5), restart(30), restart(120)]),
    });
    service.start::<&str>(&[]).map_err(|e| e.to_string())?;
    log::event("–", "–", &format!("Dienst eingerichtet ({} Links)", links.rooms.len()));
    Ok(())
}

/// `--uninstall-service`: removes the service, its links and the Strg+Alt+Entf policy.
pub fn uninstall() -> Result<(), String> {
    let manager = ServiceManager::local_computer(None::<&str>, ServiceManagerAccess::CONNECT).map_err(|e| e.to_string())?;
    stop(&manager);
    if let Ok(service) = manager.open_service(SERVICE_NAME, ServiceAccess::DELETE) {
        service.delete().map_err(|e| e.to_string())?;
    }
    let _ = std::fs::remove_file(store::path());
    set_sas_policy(false);
    for _ in 0..20 {
        if std::fs::remove_dir_all(service_dir()).is_ok() || !service_dir().exists() {
            break;
        }
        std::thread::sleep(Duration::from_millis(250));
    }
    log::event("–", "–", "Dienst entfernt");
    // a service started in between would still serve the old links
    let _ = super::client::request(&Request::Reload {});
    Ok(())
}
