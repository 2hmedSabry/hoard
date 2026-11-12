fn main() {
    // Build the on-device Vision helper (macOS only) and embed it in the app.
    #[cfg(target_os = "macos")]
    {
        let out = std::path::PathBuf::from(std::env::var("OUT_DIR").unwrap()).join("hoard-vision");
        let ok = std::process::Command::new("swiftc")
            .args(["-O", "vision/main.swift", "-o"])
            .arg(&out)
            .status()
            .map(|s| s.success())
            .unwrap_or(false);
        if !ok {
            // Keep building without AI features if Swift isn't available.
            std::fs::write(&out, b"").unwrap();
            println!("cargo:warning=swiftc failed; on-device analysis will be disabled");
        }
        println!("cargo:rerun-if-changed=vision/main.swift");
    }
    tauri_build::build()
}
