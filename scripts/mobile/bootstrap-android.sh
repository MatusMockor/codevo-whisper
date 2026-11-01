#!/usr/bin/env bash
set -euo pipefail
cache="${CODEVO_ANDROID_CACHE:-$HOME/.cache/codevo-mobile}"
mkdir -p "$cache"
fetch() {
  local url="$1" file="$2" digest="$3"
  if [[ ! -f "$file" ]]; then curl -fL --retry 2 "$url" -o "$file"; fi
  printf '%s  %s\n' "$digest" "$file" | sha256sum --check --status
}
fetch 'https://github.com/adoptium/temurin17-binaries/releases/download/jdk-17.0.21%2B9/OpenJDK17U-jdk_x64_linux_hotspot_17.0.21_9.tar.gz' "$cache/jdk.tar.gz" '8b9b611d917e3dfd8419d3566b5949226f69b052fed7e109c1368add1dfe8711'
if [[ ! -d "$cache/jdk-17.0.21+9" ]]; then tar -xzf "$cache/jdk.tar.gz" -C "$cache"; fi
fetch 'https://dl.google.com/android/repository/commandlinetools-linux-16111833_latest.zip' "$cache/cmdline-tools.zip" '0877a1d048fe4a24efe2eff536ca4223f7adeb58648bb81909d33c446918cfa8'
if [[ ! -d "$cache/android-sdk/cmdline-tools/latest" ]]; then
  mkdir -p "$cache/android-sdk/cmdline-tools"
  unzip -q "$cache/cmdline-tools.zip" -d "$cache/android-sdk/cmdline-tools"
  mv "$cache/android-sdk/cmdline-tools/cmdline-tools" "$cache/android-sdk/cmdline-tools/latest"
fi
export JAVA_HOME="$cache/jdk-17.0.21+9"
export ANDROID_HOME="$cache/android-sdk"
python3 - "$ANDROID_HOME" <<'PY'
import subprocess, sys
sdkmanager = sys.argv[1] + '/cmdline-tools/latest/bin/sdkmanager'
subprocess.run([sdkmanager, '--licenses'], input='y\n' * 100, text=True, check=True)
subprocess.run([sdkmanager, 'platform-tools', 'platforms;android-37', 'build-tools;37.0.0', 'ndk;27.1.12297006', 'cmake;3.22.1', 'emulator', 'system-images;android-36;google_apis;x86_64'], check=True)
PY
printf 'JAVA_HOME=%s\nANDROID_HOME=%s\n' "$JAVA_HOME" "$ANDROID_HOME"
