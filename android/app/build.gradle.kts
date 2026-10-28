plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "org.gng.offline"
    compileSdk = 34

    defaultConfig {
        applicationId = "org.gng.offline"
        minSdk = 26
        targetSdk = 34
        versionCode = 7
        versionName = "0.6.3"
    }

    sourceSets.getByName("main").assets.srcDir(rootProject.file("../out/android/assets"))

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
}

dependencies {
    implementation("androidx.webkit:webkit:1.12.1")
}
