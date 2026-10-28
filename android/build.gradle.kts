plugins {
    id("com.android.application") version "8.7.3" apply false
    id("org.jetbrains.kotlin.android") version "1.9.25" apply false
}

layout.buildDirectory.set(rootProject.file("../out/android/gradle-build/root"))
subprojects {
    layout.buildDirectory.set(rootProject.file("../out/android/gradle-build/${project.name}"))
}
