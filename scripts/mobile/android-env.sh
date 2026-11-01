#!/usr/bin/env bash
codevo_android_cache="${CODEVO_ANDROID_CACHE:-$HOME/.cache/codevo-mobile}"
export JAVA_HOME="${JAVA_HOME:-$codevo_android_cache/jdk-17.0.21+9}"
export ANDROID_HOME="${ANDROID_HOME:-$codevo_android_cache/android-sdk}"
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$PATH"
