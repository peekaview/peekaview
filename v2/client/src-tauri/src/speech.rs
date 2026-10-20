//! On-device speech recognition with Apple's Speech framework (macOS).

use std::{sync::mpsc, time::Duration};

use block2::RcBlock;
use objc2::{rc::Retained, AnyThread};
use objc2_foundation::{NSBundle, NSError, NSString, NSURL};
use objc2_speech::{
    SFSpeechRecognitionResult, SFSpeechRecognizer, SFSpeechRecognizerAuthorizationStatus, SFSpeechURLRecognitionRequest,
};

/// Asks for the speech recognition permission if needed. Returns whether it is granted.
pub fn authorize() -> bool {
    // without the usage description in Info.plist (e.g. `cargo run`) macOS would abort the app
    let described = NSBundle::mainBundle()
        .objectForInfoDictionaryKey(&NSString::from_str("NSSpeechRecognitionUsageDescription"))
        .is_some();
    if !described {
        return false;
    }
    let status = unsafe { SFSpeechRecognizer::authorizationStatus() };
    if status == SFSpeechRecognizerAuthorizationStatus::Authorized {
        return true;
    }
    if status != SFSpeechRecognizerAuthorizationStatus::NotDetermined {
        return false;
    }
    let (tx, rx) = mpsc::channel();
    let handler = RcBlock::new(move |status: SFSpeechRecognizerAuthorizationStatus| {
        let _ = tx.send(status);
    });
    unsafe { SFSpeechRecognizer::requestAuthorization(&handler) };
    rx.recv_timeout(Duration::from_secs(120)) == Ok(SFSpeechRecognizerAuthorizationStatus::Authorized)
}

/// Is on-device recognition available for the system language?
pub fn available() -> bool {
    let recognizer = unsafe { SFSpeechRecognizer::new() };
    unsafe { recognizer.isAvailable() && recognizer.supportsOnDeviceRecognition() }
}

/// Transcribes a WAV file's worth of audio on the device. Blocks until done.
pub fn transcribe(wav: &[u8]) -> Option<String> {
    let path = std::env::temp_dir().join(format!("peekaview-{}-{:?}.wav", std::process::id(), std::thread::current().id()));
    std::fs::write(&path, wav).ok()?;
    let result = run(&path);
    let _ = std::fs::remove_file(&path);
    result
}

fn run(path: &std::path::Path) -> Option<String> {
    let recognizer = unsafe { SFSpeechRecognizer::new() };
    if !unsafe { recognizer.isAvailable() } {
        return None;
    }
    let url = NSURL::fileURLWithPath(&NSString::from_str(path.to_str()?));
    let request: Retained<SFSpeechURLRecognitionRequest> =
        unsafe { SFSpeechURLRecognitionRequest::initWithURL(SFSpeechURLRecognitionRequest::alloc(), &url) };
    unsafe {
        request.setShouldReportPartialResults(false);
        request.setAddsPunctuation(true);
        if recognizer.supportsOnDeviceRecognition() {
            request.setRequiresOnDeviceRecognition(true);
        }
    }

    let (tx, rx) = mpsc::channel::<Option<String>>();
    let handler = RcBlock::new(move |result: *mut SFSpeechRecognitionResult, error: *mut NSError| {
        if let Some(result) = unsafe { result.as_ref() } {
            if unsafe { result.isFinal() } {
                let _ = tx.send(Some(unsafe { result.bestTranscription().formattedString() }.to_string()));
            }
        } else if !error.is_null() {
            let _ = tx.send(None);
        }
    });
    // results are delivered on the main queue; this runs on a worker thread
    let _task = unsafe { recognizer.recognitionTaskWithRequest_resultHandler(&request, &handler) };
    rx.recv_timeout(Duration::from_secs(120)).ok().flatten()
}
