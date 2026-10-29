plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

val appId = providers.gradleProperty("AO_APP_ID").getOrElse("org.gng.offline")
val appLabel = providers.gradleProperty("AO_APP_LABEL").getOrElse("Ghosts'n Goblins")
val assetsDir = providers.gradleProperty("AO_ASSETS_DIR")
    .getOrElse("../out/android/assets")

android {
    namespace = "org.gng.offline"
    compileSdk = 34

    defaultConfig {
        applicationId = appId
        manifestPlaceholders["appLabel"] = appLabel
        minSdk = 26
        targetSdk = 34
        versionCode = 8
        versionName = "0.7.0"
    }

    sourceSets.getByName("main").assets.srcDir(rootProject.file(assetsDir))

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
}

dependencies {
    implementation("androidx.webkit:webkit:1.12.1")
}
