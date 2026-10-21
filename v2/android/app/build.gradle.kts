plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "de.limtec.peekaview"
    compileSdk = 35

    defaultConfig {
        applicationId = "de.limtec.peekaview"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "2.0.0"
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
}

val copyWeb by tasks.registering(Sync::class) {
    from(rootProject.file("../web")) {
        include("*.html", "*.js", "vendor/**")
    }
    into(layout.buildDirectory.dir("generated/web-assets/web"))
}
tasks.named("preBuild") { dependsOn(copyWeb) }

dependencies {
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.activity:activity-ktx:1.9.3")
    implementation("androidx.webkit:webkit:1.12.1")
    // WebRTC (Google's libwebrtc, maintained build) – the host side of a share
    implementation("io.getstream:stream-webrtc-android:1.3.8")
    // Nostr signaling: websockets to the relays, Schnorr signatures (secp256k1)
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("fr.acinq.secp256k1:secp256k1-kmp-jni-android:0.15.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")
}
