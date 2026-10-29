fn main() {
    for name in ["TIAO_DISTRIBUTION_CHANNEL", "TIAO_STEAM_APP_ID"] {
        println!("cargo:rerun-if-env-changed={name}");
    }
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        for source in ["steam_overlay_mac.m", "storekit.m"] {
            println!("cargo:rerun-if-changed=src/{source}");
            cc::Build::new()
                .file(format!("src/{source}"))
                .flag("-fobjc-arc")
                .flag("-Wno-deprecated-declarations")
                .compile(source);
        }
        for framework in ["AppKit", "Metal", "MetalKit", "QuartzCore", "StoreKit"] {
            println!("cargo:rustc-link-lib=framework={framework}");
        }
    }
    tauri_build::build()
}
