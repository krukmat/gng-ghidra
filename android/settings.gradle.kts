pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}
rootProject.name = "GngOffline"
// The app module is the base's generic shell, from the pinned copy.
include(":app")
project(":app").projectDir = file("../base/templates/android/app")
