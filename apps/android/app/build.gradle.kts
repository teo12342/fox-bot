plugins { id("com.android.application"); id("org.jetbrains.kotlin.android"); id("org.jetbrains.kotlin.plugin.compose") }
android {
    namespace = "app.foxbot"
    compileSdk = 35
    defaultConfig { applicationId = "app.foxbot"; minSdk = 29; targetSdk = 35; versionCode = 1; versionName = "0.1.0"; ndk { abiFilters += listOf("arm64-v8a", "x86_64") } }
    signingConfigs {
        create("release") {
            val path = System.getenv("FOX_ANDROID_KEYSTORE")
            if (path != null) { storeFile = file(path); storePassword = System.getenv("FOX_ANDROID_STORE_PASSWORD"); keyAlias = System.getenv("FOX_ANDROID_KEY_ALIAS"); keyPassword = System.getenv("FOX_ANDROID_KEY_PASSWORD") }
        }
    }
    buildTypes { getByName("release") { signingConfig = signingConfigs.getByName("release"); isMinifyEnabled = false } }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
    kotlinOptions { jvmTarget = "17" }
    buildFeatures { compose = true }
}
dependencies {
    implementation(platform("androidx.compose:compose-bom:2025.04.01"))
    implementation("androidx.activity:activity-compose:1.10.1")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.9.0")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("io.getstream:stream-webrtc-android:1.3.9")
    implementation("com.google.android.gms:play-services-code-scanner:16.1.0")
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20240303")
}
val verifyReleaseSigning = tasks.register("verifyReleaseSigning") {
    doLast {
        require(listOf("FOX_ANDROID_KEYSTORE", "FOX_ANDROID_STORE_PASSWORD", "FOX_ANDROID_KEY_ALIAS", "FOX_ANDROID_KEY_PASSWORD").all { !System.getenv(it).isNullOrBlank() }) { "Release requires FOX_ANDROID_KEYSTORE, FOX_ANDROID_STORE_PASSWORD, FOX_ANDROID_KEY_ALIAS and FOX_ANDROID_KEY_PASSWORD. Debug signing is not a publication credential." }
    }
}
tasks.configureEach { if(name in listOf("preReleaseBuild", "assembleRelease", "bundleRelease")) dependsOn(verifyReleaseSigning) }
