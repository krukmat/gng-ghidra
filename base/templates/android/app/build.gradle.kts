// Android WebView shell for a migrated game. The consuming project includes
// this module and supplies identity, version and the generated web assets as
// Gradle properties; the template carries no game identity or defaults.
plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

fun required(name: String): String =
    providers.gradleProperty(name).orNull ?: error("SHELL_PROPERTY_MISSING $name")

android {
    namespace = "org.rommigration.shell"
    compileSdk = 34

    defaultConfig {
        applicationId = required("SHELL_APP_ID")
        manifestPlaceholders["appLabel"] = required("SHELL_APP_LABEL")
        minSdk = 26
        targetSdk = 34
        versionCode = required("SHELL_VERSION_CODE").toInt()
        versionName = required("SHELL_VERSION_NAME")
        // Launcher icon: mipmap/ic_launcher and ic_launcher_round from
        // SHELL_RES_DIR when the project gives one, else the system default.
        val icons = providers.gradleProperty("SHELL_RES_DIR").isPresent
        manifestPlaceholders["appIcon"] =
            if (icons) "@mipmap/ic_launcher" else "@android:drawable/sym_def_app_icon"
        manifestPlaceholders["appRoundIcon"] =
            if (icons) "@mipmap/ic_launcher_round" else "@android:drawable/sym_def_app_icon"
    }

    // Relative to the consuming project's root, which owns the assets.
    sourceSets.getByName("main").assets.srcDir(rootProject.file(required("SHELL_ASSETS_DIR")))
    providers.gradleProperty("SHELL_RES_DIR").orNull?.let {
        sourceSets.getByName("main").res.srcDir(rootProject.file(it))
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
}

dependencies {
    implementation("androidx.webkit:webkit:1.12.1")
}
