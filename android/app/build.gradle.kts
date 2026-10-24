import java.security.MessageDigest
import java.net.URI

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

val scrcpyVersion = "5.0.1"

android {
    namespace = "de.limtec.peekaview"
    compileSdk = 35

    defaultConfig {
        applicationId = "de.limtec.peekaview"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "2.0.0"
        buildConfigField("String", "SCRCPY_VERSION", "\"$scrcpyVersion\"")
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
    buildFeatures {
        buildConfig = true
    }
    // the viewer website (../../web) is bundled: the same viewer as in browsers and the desktop app
    sourceSets["main"].assets.srcDir(layout.buildDirectory.dir("generated/web-assets"))
    sourceSets["main"].assets.srcDir(layout.buildDirectory.dir("generated/shell-assets"))
}

val copyWeb by tasks.registering(Sync::class) {
    from(rootProject.file("../web")) {
        include("*.html", "*.js", "*.css", "*.webmanifest", "*.png", "vendor/**")
    }
    into(layout.buildDirectory.dir("generated/web-assets/web"))
}
tasks.named("preBuild") { dependsOn(copyWeb) }

// The protocol client and server must have exactly the same version. Never download on device.
val shellServer by tasks.registering {
    val asset = layout.buildDirectory.file("generated/shell-assets/scrcpy-server")
    val checksum = "764eb6f79811d5211fe9df341120882ba9994c7a61b897d7bf3fb662e53bc536"
    inputs.property("sha256", checksum)
    inputs.property("version", scrcpyVersion)
    outputs.file(asset)
    doLast {
        val file = asset.get().asFile
        file.parentFile.mkdirs()
        val bytes = URI("https://github.com/Genymobile/scrcpy/releases/download/v$scrcpyVersion/scrcpy-server-v$scrcpyVersion")
            .toURL().openStream().use { it.readBytes() }
        val hash = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }
        check(hash == checksum) { "scrcpy-server: SHA-256 stimmt nicht überein" }
        file.writeBytes(bytes)
    }
}
tasks.named("preBuild") { dependsOn(shellServer) }

dependencies {
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.activity:activity-ktx:1.9.3")
    implementation("androidx.webkit:webkit:1.12.1")
    // WebRTC (Google's libwebrtc, maintained build) – the host side of a share
    implementation("io.getstream:stream-webrtc-android:1.3.8")
    // Nostr signaling: websockets to the relays (Schnorr signatures: Schnorr.kt)
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")
    implementation("com.github.MuntashirAkon:libadb-android:3.1.1")
    implementation("org.conscrypt:conscrypt-android:2.8.0")
    testImplementation("junit:junit:4.13.2")
    androidTestImplementation("androidx.test:runner:1.7.0")
    androidTestImplementation("androidx.test.ext:junit:1.3.0")
}
