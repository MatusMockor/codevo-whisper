# Build and verify the mobile app

The React Native phone app lives in `apps/mobile`. Android ships a voice-only keyboard and a foreground recorder. The same TypeScript UI, pairing, and session code serves the iOS companion target. Electron stays in `apps/desktop`.

## Prepare Linux

Install the repository dependencies with `pnpm install --frozen-lockfile`.

Run `scripts/mobile/bootstrap-android.sh` to install the pinned JDK and Android tools under `~/.cache/codevo-mobile`. The script checks archive SHA-256 digests and leaves system installations untouched. SDK package identifiers follow the React Native 0.88.1 template. Set `CODEVO_ANDROID_CACHE` to use another directory.

Load the tool paths in a shell without an existing `JAVA_HOME` override:

```sh
source scripts/mobile/android-env.sh
```

Create an API 36 emulator once:

```sh
printf 'no\n' | "$ANDROID_HOME/cmdline-tools/latest/bin/avdmanager" create avd \
  -n codevo-api36 -k 'system-images;android-36;google_apis;x86_64' --device pixel_6
```

Start the emulator with at most four CPU cores:

```sh
"$ANDROID_HOME/emulator/emulator" -avd codevo-api36 -no-window -no-audio \
  -no-boot-anim -no-snapshot -gpu swiftshader -cores 4 -memory 3072
```

Wait for `adb shell getprop sys.boot_completed` to print `1`.

## Run Android acceptance

Use a disposable emulator. Acceptance clears `com.codevo.mobile` data, grants its microphone permission, installs a separate editor fixture, changes the selected keyboard, and enables the emulator's software keyboard. Host loopback ports 18787 and 18788 must be free.

```sh
scripts/mobile/verify-android.sh
```

The verification APK is signed with the public development key, has bundled release Hermes bytecode, and runs without Metro. It supports arm64 phones and x86_64 emulators. Its path is `apps/mobile/android/app/build/outputs/apk/verification/app-verification.apk`. Use it for evaluation, not store distribution.

Acceptance starts the real gateway with deterministic STT, pairs through server operator approval, force-stops the app, and selects its IME from another application. It checks insertion once, editor changes after Stop, cancel, hide, password blocking, Gboard switching, a WebView editor, and the shared foreground recorder. A separate encrypted protocol peer checks pairing rejection, retention of the previous pairing, flow pause/resume, and server errors in Hermes. That peer uses the existing Noise implementation and never changes production server behavior. Native instrumentation checks Keystore encryption, tamper rejection, failed replacement preservation, and backup exclusion. The native AudioRecord pipeline runs on the emulator. Acoustic speech quality and physical microphone behavior need a phone.

Run the existing repository checks separately:

```sh
buildq pnpm lint
buildq pnpm typecheck
buildq pnpm test
```

## Configure a real server

Use a `wss://` public pairing endpoint with a trusted TLS certificate. The release variant rejects cleartext network connections. The verification variant permits Noise over `ws://` only to `localhost`, `127.0.0.1`, and `10.0.2.2`. These exceptions are confined to its Android resource overlay. A pairing token with another `ws://` host needs a TLS endpoint; the app does not downgrade authentication or disable TLS validation.

The app targets SDK 36, as specified by the pinned React Native template. Android 17 enforces the local-network runtime permission for apps targeting SDK 37 or later. Revisit the permission flow before raising the target. See [Android local-network permissions](https://developer.android.com/privacy-and-security/local-network-permission) and [network security configuration](https://developer.android.com/privacy-and-security/security-config).

Open Codevo Voice, paste the server's `cw1` token, compare the connection fingerprint on both screens, and approve on the server. Allow microphone access, enable Codevo Voice in Android keyboard settings, and keep Gboard enabled. Choose Codevo Voice from an ordinary text field. Record connects before starting the microphone. Stop sends the remaining PCM before finish. Cancel discards the result.

For distribution, build `:app:assembleRelease` or `:app:bundleRelease` through `buildq` and configure your own signing credentials outside the repository. The release output is unsigned by default. Never distribute the development signing key as a production identity.

## Build the iOS companion on macOS

Use `apps/mobile/ios/CodevoMobile.xcodeproj` and the `CodevoMobile` scheme. Install CocoaPods dependencies in `apps/mobile/ios`, open the generated workspace, and configure your signing team. The native adapter uses Keychain with `WhenUnlockedThisDeviceOnly`, `SecRandomCopyBytes`, and AVAudioEngine conversion to mono 16 kHz PCM16. It stops on backgrounding or audio interruption. Its native URLSession WebSocket adapter serializes sends and retains byte reservations until send completion; a stalled send terminates the connection after ten seconds. Only TLS endpoints are supported.

This target has not been compiled, signed, or run on Linux. macOS/Xcode and device validation are required before calling it usable. No iOS keyboard extension target exists in this delivery. See [React Native environment setup](https://reactnative.dev/docs/set-up-your-environment), [Headless JS](https://reactnative.dev/docs/headless-js-android), and the [official template](https://github.com/react-native-community/template/tree/0.88-stable).
