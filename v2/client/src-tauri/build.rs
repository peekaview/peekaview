fn main() {
    // screencapturekit links the Swift runtime via @rpath; link args of dependencies don't reach
    // our binary, so the system Swift location has to be added here.
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        println!("cargo:rustc-link-arg=-Wl,-rpath,/usr/lib/swift");
    }
    tauri_build::build()
}
