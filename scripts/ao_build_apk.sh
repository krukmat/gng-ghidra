#!/usr/bin/env bash
set -euo pipefail
umask 077

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export JAVA_HOME="${JAVA_HOME:-/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home}"
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
unset ANDROID_SDK_ROOT # Gradle rejects a second SDK path when it differs.

# emsdk only for the bank build: later steps keep the caller's node and python3.
node_bin="$(command -v node)"
(
  # shellcheck disable=SC1091
  source "${EMSDK:-$HOME/emsdk}/emsdk_env.sh" >/dev/null 2>&1
  "$node_bin" "$repo_dir/base/src/devices/ym2203/build.mjs" "$repo_dir/out/audio/ymfm" \
    "$repo_dir/out/android/ym2203-bank"
)
# The dual-YM reference WASM stays a checkpoint-gate and RP-3 comparison input.
bash "$repo_dir/scripts/ao_build_audio_wasm.sh"
node "$repo_dir/scripts/ao_build_assets.mjs"
gradle_args=()
[[ -z "${AO_APP_ID:-}" ]] || gradle_args+=("-PSHELL_APP_ID=$AO_APP_ID")
[[ -z "${AO_APP_LABEL:-}" ]] || gradle_args+=("-PSHELL_APP_LABEL=$AO_APP_LABEL")
[[ -z "${AO_ASSETS_DIR:-}" ]] || gradle_args+=("-PSHELL_ASSETS_DIR=$AO_ASSETS_DIR")
(cd "$repo_dir/android" && ./gradlew --no-daemon ${gradle_args[@]+"${gradle_args[@]}"} assembleDebug)
install -m 600 "$repo_dir/out/android/gradle-build/app/outputs/apk/debug/app-debug.apk" \
  "$repo_dir/out/android/gng.apk"
echo "AO_APK=out/android/gng.apk"
