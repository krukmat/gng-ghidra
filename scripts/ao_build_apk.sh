#!/usr/bin/env bash
set -euo pipefail
umask 077

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export JAVA_HOME="${JAVA_HOME:-/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home}"
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"

node "$repo_dir/scripts/ao_build_assets.mjs"
(cd "$repo_dir/android" && ./gradlew --no-daemon assembleDebug)
install -m 600 "$repo_dir/out/android/gradle-build/app/outputs/apk/debug/app-debug.apk" \
  "$repo_dir/out/android/gng.apk"
echo "AO_APK=out/android/gng.apk"
