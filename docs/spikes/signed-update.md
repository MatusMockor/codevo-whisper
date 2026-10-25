# Spike: signed, notarized Electron app with auto-update

Phase 0, Task 4. Spike code: `spikes/signed-update/` (throwaway, standalone package, not a workspace member).

## Setup

| Item | Value |
|---|---|
| Host | Apple silicon Mac (arm64), macOS 26 (Darwin 25.6.0), Rosetta 2 installed |
| Node / pnpm | 24.13.1 / 10.34.5 |
| electron | 45.0.0 |
| electron-builder | 26.18.0 |
| electron-updater | 6.8.11 (builder-util-runtime 9.7.0) |
| Identity | `Developer ID Application: codevo s.r.o. (U574W69TH6)` from the login keychain |
| Notarization | App Store Connect API key via `APPLE_API_KEY`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER` (shell env only) |
| Update feed | `http-server` on `127.0.0.1:8099` serving `spikes/signed-update/feed/` |

Spike app (`src/main.js`): shows version and arch, calls `autoUpdater.checkForUpdates()` on start, logs every updater event to `~/Library/Logs/CodevoWhisperSpike/update.log`, calls `quitAndInstall(true, true)` 1.5 s after `update-downloaded`.

## electron-builder mac config

`spikes/signed-update/electron-builder.yml`:

```yaml
appId: app.codevo.whisper
productName: Codevo Whisper Spike
artifactName: codevo-whisper-spike-${version}-${arch}-mac.${ext}
directories:
  output: release/${version}-${arch}
files:
  - src/**
  - package.json
mac:
  category: public.app-category.productivity
  target:
    - dmg
    - zip
  identity: "codevo s.r.o. (U574W69TH6)"
  hardenedRuntime: true
  gatekeeperAssess: false
  entitlements: build/entitlements.mac.plist
  entitlementsInherit: build/entitlements.mac.plist
  notarize: true
  extendInfo:
    NSMicrophoneUsageDescription: Codevo Whisper Spike needs the microphone for dictation.
dmg:
  sign: true
publish:
  provider: generic
  url: http://127.0.0.1:8099/
```

Notes:
- `notarize: true` makes electron-builder 26 call `@electron/notarize` (notarytool) with the API key env vars (`app-builder-lib/out/mac/MacTargetHelper.js` `getNotarizeOptions` lines 219-255, `notarizeIfProvided` lines 256-270). Only the `.app` is notarized and stapled; the DMG is not (`notarizeIfProvided(appPath)` is called once per app in `macPackager.js:347`, nothing in `dmg-builder` notarizes). The DMG is notarized and stapled afterwards by `scripts/notarize-dmg.sh` (`notarytool submit --wait`, `stapler staple`, `stapler validate`).
- `${arch}` in `artifactName` is required: MacUpdater picks the arm64 ZIP by looking for `arm64` in the URL (see Update test).
- The build commands run per architecture (`--mac --arm64`, `--mac --x64`) like the planned CI matrix with native runners. v0.0.2 was built with `-c.extraMetadata.version=0.0.2`.
- pnpm needs `node-linker=hoisted` (`.npmrc`) so electron-builder's node_modules collector sees a flat tree.

## Entitlements

`spikes/signed-update/build/entitlements.mac.plist` (used for the app and, via `entitlementsInherit`, for helpers/frameworks):

```xml
<dict>
  <key>com.apple.security.cs.allow-jit</key>
  <true/>
  <key>com.apple.security.device.audio-input</key>
  <true/>
</dict>
```

`allow-jit` is what Electron/V8 needs under the hardened runtime; no `allow-unsigned-executable-memory` or `disable-library-validation` was needed for a plain Electron 45 app. Native helpers added in later phases must be checked again (library validation matters as soon as a helper loads a non-team dylib).

Signed result (`codesign -dvv` / `codesign -d -r-` on the arm64 app):

```
Identifier=app.codevo.whisper
CodeDirectory v=20500 size=446 flags=0x10000(runtime) hashes=3+7 location=embedded
Authority=Developer ID Application: codevo s.r.o. (U574W69TH6)
Authority=Developer ID Certification Authority
Authority=Apple Root CA
TeamIdentifier=U574W69TH6
designated => identifier "app.codevo.whisper" and anchor apple generic and certificate 1[field.1.2.840.113635.100.6.2.6] /* exists */ and certificate leaf[field.1.2.840.113635.100.6.1.13] /* exists */ and certificate leaf[subject.OU] = U574W69TH6
```

`codesign --verify --deep --strict` reports `valid on disk` and `satisfies its Designated Requirement`.

Pending: `spctl` reports `rejected, source=Unnotarized Developer ID` for all four apps until the notarization submissions are accepted (see "Notarized run (pending)").

## Merged mac manifest (Step 2)

Each per-arch run writes its own `latest-mac.yml` with only its own ZIP (and DMG) entry. electron-builder merges entries itself only when both archs are built in one invocation and land in the same output dir (`writeUpdateInfoFiles` keys tasks by manifest path and concatenates `files`, `app-builder-lib/out/publish/updateInfoBuilder.js:155-180`). With `directories.output: release/${version}-${arch}`, or with separate CI jobs, the second manifest would overwrite the first and one architecture would stop updating.

Procedure used (`scripts/merge-latest-mac.mjs`, `scripts/verify-feed.mjs`):

```bash
mkdir -p feed
cp release/0.0.2-arm64/*.zip release/0.0.2-arm64/*.blockmap release/0.0.2-x64/*.zip release/0.0.2-x64/*.blockmap feed/
node scripts/merge-latest-mac.mjs feed/latest-mac.yml release/0.0.2-arm64/latest-mac.yml release/0.0.2-x64/latest-mac.yml
node scripts/verify-feed.mjs feed/latest-mac.yml
./node_modules/.bin/http-server feed -p 8099 -a 127.0.0.1 -c-1
```

The merge script refuses mismatched versions, entries without `url`/`sha512`/integer `size`, and a manifest without any ZIP. It de-duplicates by `url`, keeps the latest `releaseDate`, and sets the legacy top-level `path`/`sha512` to the x64 ZIP, which is the same order electron-builder uses in a single run (x64 sorts before arm64 in `writeUpdateInfoFiles`). `verify-feed.mjs` re-hashes every file in the feed dir against the manifest and requires one ZIP per architecture.

Merged result (sha512 abbreviated):

```yaml
version: 0.0.2
files:
  - url: codevo-whisper-spike-0.0.2-arm64-mac.zip
    sha512: <88 chars base64>
    size: <bytes>
  - url: codevo-whisper-spike-0.0.2-x64-mac.zip
    sha512: <88 chars base64>
    size: <bytes>
path: codevo-whisper-spike-0.0.2-x64-mac.zip
sha512: <x64 zip sha512>
releaseDate: '<latest of the two>'
```

DMG entries: electron-builder 26 writes only the ZIP into `latest-mac.yml` for this config; DMGs are installer downloads, not updater input. MacUpdater needs a ZIP (`ERR_UPDATER_ZIP_FILE_NOT_FOUND`, `electron-updater/out/MacUpdater.js:80-83`).

How MacUpdater picks the file (`MacUpdater.filterFilesForArch`, `MacUpdater.js:30-36, 52-79`): it treats the Mac as arm64 if `uname -a` contains `ARM`, `process.arch === "arm64"`, or `sysctl.proc_translated` is 1 (Rosetta). On an arm64 Mac it keeps only URLs containing `arm64` (if any exist); otherwise it drops every URL containing `arm64`. Consequences:
- the arch must be in the file name (`${arch}` in `artifactName`), and x64 file names must never contain `arm64`;
- an x64 build running under Rosetta on Apple silicon is migrated to the arm64 build on its first update (observed, see Step 3);
- the x64 ZIP is only ever chosen on Intel Macs, so it cannot be exercised end to end on Apple silicon with the merged manifest. It was tested here with an x64-only manifest instead.

## N -> N+1 update (Step 3)

Flow in the spike app: `checkForUpdates()` on `ready`, `autoDownload: true`, `quitAndInstall(true, true)` 1.5 s after `update-downloaded`. electron-updater downloads and sha512-checks the ZIP, then starts a localhost proxy and hands it to Squirrel.Mac (`autoUpdater.setFeedURL` on Electron's native updater); Squirrel downloads the ZIP again through the proxy, unpacks it under `~/Library/Caches/app.codevo.whisper.ShipIt/`, checks the code signature, and ShipIt swaps the bundle in place and relaunches it.

Launch gotcha: shells started by Claude Code / VS Code export `ELECTRON_RUN_AS_NODE=1`, and `open` passes the caller's environment to the app. With the default fuses (see Recommendations) the signed app then starts as plain Node, prints nothing and exits 0 after ~1.7 s. All runs below use `env -u ELECTRON_RUN_AS_NODE open "<app>"`.

### Dry run: signed, not yet notarized, no quarantine

Done while the notarization submissions were pending, from ZIPs built with `--prepackaged` off the signed apps, installed with `ditto -x -k` into a scratch dir (no quarantine attribute, so Gatekeeper did not assess the launch).

| Case | Feed | Result | Quit -> relaunch |
|---|---|---|---|
| arm64 0.0.1 | merged | relaunched `0.0.2`, `arm64`, native | ~4 s |
| x64 0.0.1 under Rosetta | merged | relaunched `0.0.2` **arm64 native** (`isRosetta=true` -> arm64 ZIP) | ~5 s |
| x64 0.0.1 under Rosetta | x64-only manifest | relaunched `0.0.2`, `x64`, `translated: true` | ~26 s (Rosetta translation of the new binary) |
| arm64 0.0.1 | 0.0.2 re-signed ad hoc, correct sha512 | rejected by Squirrel: `SQRLCodeSignatureErrorDomain -1`, `Code signature ... did not pass validation: code failed to satisfy specified code requirement(s)`; app keeps running 0.0.1 | - |
| arm64 0.0.1 | genuine 0.0.2, wrong sha512 | rejected by electron-updater before Squirrel: `sha512 checksum mismatch`; app keeps running 0.0.1 | - |

Log excerpt (arm64, merged feed):

```
[info] app ready {"version":"0.0.1","arch":"arm64","translated":false,...}
[info] Found version 0.0.2 (url: codevo-whisper-spike-0.0.2-arm64-mac.zip, codevo-whisper-spike-0.0.2-x64-mac.zip)
[info] event update-downloaded {"version":"0.0.2",...}
[info] calling quitAndInstall
[debug] nativeUpdater.update-downloaded
[info] before-quit {"version":"0.0.1"}
[info] app ready {"version":"0.0.2","arch":"arm64","translated":false,...}
[info] Update for version 0.0.2 is not available (latest version: 0.0.2, downgrade is disallowed).
```

### Notarized run (pending)

Not done yet. All four notarization submissions (first at 2026-10-25 13:49 UTC) were still `In Progress` at 16:00 UTC. First submissions from a new developer team are known to take hours. When `xcrun notarytool history` shows `Accepted`: staple, install the quarantined DMG builds into `~/Applications`, repeat the arm64 and x64 update cases and record Gatekeeper prompts here.

## Linux update verification (spec 10, open question 4)

Read from the installed sources: electron-updater 6.8.11, builder-util-runtime 9.7.0, app-builder-lib 26.18.0 (paths relative to `spikes/signed-update/node_modules/`).

What is verified:
- **sha512 of the downloaded file against `latest-linux.yml`.** Every file entry must carry `sha2` or `sha512`, otherwise `resolveFiles` throws `ERR_UPDATER_NO_CHECKSUM` (`electron-updater/out/providers/Provider.js:124-129`). `AppUpdater.executeDownload` passes `sha512` into the download options (`electron-updater/out/AppUpdater.js:559-566`), the HTTP layer pipes the body through `DigestTransform` (`builder-util-runtime/out/httpExecutor.js:468-473`), which fails with `ERR_CHECKSUM_MISMATCH` on mismatch (`httpExecutor.js:393-435`, logged in `AppUpdater.js:649-654`). A cached download is re-hashed before reuse (`electron-updater/out/DownloadedUpdateHelper.js:114-126`). Differential AppImage downloads verify the reassembled file against the same sha512 (`electron-updater/out/differentialDownloader/DifferentialDownloader.js:121`).
- **Version**: only a strictly greater semver is installed unless `allowDowngrade` is set (`AppUpdater.js:339-363`).
- **Transport**: whatever the provider URL gives; with the GitHub provider that is HTTPS to github.com / objects.githubusercontent.com.

What is not verified:
- **No publisher signature on Linux.** The only publisher check in electron-updater is Windows-only: `NsisUpdater.verifySignature` uses `publisherName` and Authenticode (`electron-updater/out/NsisUpdater.js:16-27, 84-99`, `windowsExecutableCodeSignatureVerifier.js`; schema option `verifyUpdateCodeSignature` exists only in `WindowsConfiguration` in `app-builder-lib/scheme.json:8805-8809`). `AppImageUpdater` downloads, `chmod 0755`s and `mv`s the new AppImage over the old one and spawns it (`electron-updater/out/AppImageUpdater.js:30-48, 72-115`) without any signature check. No GPG/AppImage signature support exists in app-builder-lib's Linux targets (no `gpg` references in `app-builder-lib/out/targets/`).
- **deb is installed unsigned and as root.** `DebUpdater.doInstall` runs `dpkg -i <file>` through `pkexec`/`sudo` (falls back to `apt-get install -f -y`), or `apt install -y --allow-unauthenticated --allow-downgrades --allow-change-held-packages` (`electron-updater/out/DebUpdater.js:27-81`, `LinuxUpdater.js:34-84`). RPM uses `--nogpgcheck` (`RpmUpdater.js:52-55`). The deb update path therefore turns "whoever can publish `latest-linux.yml` + artifact" into root code execution after one polkit prompt.
- **The manifest itself is not signed.** sha512 comes from the same feed as the binary, so it protects against corruption and partial downloads, not against a compromised release or a compromised GitHub token. Anyone who can upload release assets can publish a matching manifest.
- Updater selection is by `resources/package-type` (`deb`/`rpm`/`pacman`) or the `APPIMAGE` env var (`electron-updater/out/main.js:47-75`); with neither, the AppImage updater is inactive.

Comparison with macOS: Squirrel.Mac (inside Electron's `Squirrel.framework`) checks that the downloaded bundle satisfies the designated requirement of the running app before swapping it in (`SQRLCodeSignature`, strings `-verifyCodeSignatureOfBundle:`, `Code signature at URL %@ did not pass validation`, `currentApplicationSignature:` are present in `Contents/Frameworks/Squirrel.framework/Versions/A/Squirrel` of the built app). macOS updates are therefore bound to Team ID U574W69TH6 and bundle ID `app.codevo.whisper`; Linux updates are bound to nothing but the feed.

## Recommendations for the release phase (spec 10)

Build topology and manifest merge:
- Keep the per-arch native runners from spec 10, but build jobs run `electron-builder --mac --<arch> --publish never` and upload `release/` as workflow artifacts. Per-arch jobs must never publish `latest-mac.yml` themselves: with the GitHub provider the second upload replaces the first and one architecture silently stops updating.
- The publish job (after the whole matrix is green) downloads both artifact sets, runs `merge-latest-mac.mjs` and `verify-feed.mjs` (move both into `scripts/release/`), uploads ZIPs, blockmaps, DMGs and the merged `latest-mac.yml` to a **draft** release, re-downloads `latest-mac.yml` from the draft and verifies it again, then publishes the release. Publishing the draft is the single atomic switch for all clients.
- Alternative that needs no merge: one arm64 runner building `--mac --arm64 --x64` in one invocation with a shared output dir (electron-builder then writes one combined manifest). Cross-building x64 on arm64 works (the x64 builds in this spike were built on Apple silicon). Cost: no native x64 test in CI. Only worth it if Intel runners become unavailable.
- Linux needs no merge: electron-builder writes `latest-linux.yml` for x64 and `latest-linux-arm64.yml` for arm64 (`getArchPrefixForUpdateFile`, `updateInfoBuilder.js:55-60`).

Artifact naming:
- `artifactName: codevo-whisper-${version}-${arch}-${os}.${ext}`, e.g. `codevo-whisper-1.2.0-arm64-mac.zip`, `codevo-whisper-1.2.0-x64-mac.dmg`. The `${arch}` token is mandatory for MacUpdater's file selection; x64 names must not contain `arm64`. Do not add a universal build next to the per-arch builds (it would match neither filter rule cleanly and doubles download size).
- Keep `appId: app.codevo.whisper` and Team ID U574W69TH6 forever: Squirrel.Mac only accepts an update that satisfies the running app's designated requirement (`identifier "app.codevo.whisper" and anchor apple generic and ... leaf[subject.OU] = U574W69TH6`). Rotating the Developer ID certificate within the same team is fine; changing bundle ID or team breaks updates for every installed copy.

Signing and notarization:
- electron-builder notarizes and staples only the `.app`; the DMG needs its own `notarytool submit --wait`, `stapler staple`, `stapler validate` (`scripts/notarize-dmg.sh`). Build the DMG and ZIP from the already stapled `.app` (electron-builder's order) so offline first launch works.
- Apple's notarization latency is not bounded. Set an explicit `timeout-minutes` on the build jobs, call notarytool with `--timeout`, and on timeout fail with the submission ID so a re-run can `notarytool wait <id>` instead of re-submitting. Observed on the first submissions of this team: more than 2 hours in `In Progress`.
- CI gates after signing, per arch: `codesign --verify --deep --strict` on the app, `spctl --assess --type execute -vv` on the app (must print `source=Notarized Developer ID`), `xcrun stapler validate` on app and DMG, `spctl --assess --type open --context context:primary-signature -vv` on the DMG, `@electron/fuses read` matching the expected fuse set, then `verify-feed.mjs` in the publish job.

Electron fuses (new requirement, not in spec yet):
- The spike app ships Electron's default fuses: `RunAsNode`, `EnableNodeOptionsEnvironmentVariable`, `EnableNodeCliInspectArguments` enabled, asar integrity off. With these, any local process can run arbitrary JS under our signature (`ELECTRON_RUN_AS_NODE=1 ".../Codevo Whisper"`, observed by accident above) and inherit our TCC grants (Microphone, Accessibility, Input Monitoring), which is exactly what a dictation app must not leak.
- Set in electron-builder (supported by 26.18, `electronFuses`, flipped right before signing in `platformPackager.js:261-268`): `runAsNode: false`, `enableNodeOptionsEnvironmentVariable: false`, `enableNodeCliInspectArguments: false`, `enableEmbeddedAsarIntegrityValidation: true`, `onlyLoadAppFromAsar: true`, `enableCookieEncryption: true`. Not tested with the updater in this spike; the phase 3 build must repeat the N -> N+1 test with these fuses.
- electron-updater on macOS does not need `RunAsNode` (ShipIt is a separate signed binary inside `Squirrel.framework`).

Update acceptance tests:
- arm64: N -> N+1 on Apple silicon with the merged manifest, app installed from the notarized DMG with quarantine.
- x64: must run on an Intel Mac (real hardware or an Intel runner). On Apple silicon the merged manifest always serves arm64, even to an x64 build under Rosetta; that migration is desirable for users but means Apple silicon cannot test the x64 ZIP path except with an x64-only manifest.
- Negative checks worth keeping in the release checklist: a ZIP with a wrong sha512 and a ZIP signed by another identity must both be rejected without leaving the app in a broken state (both pass in this spike).
- Test scripts and docs that launch the app from a terminal must unset `ELECTRON_RUN_AS_NODE`.

Linux (answers spec 11, question 4; for spec 10):
- electron-updater verifies only sha512 from the same feed plus HTTPS; there is no publisher signature check for AppImage or deb.
- Ship auto-update for AppImage only. For deb, do not use `DebUpdater` auto-install (root `dpkg -i` of an unsigned package after one polkit prompt); show "update available" with a link to the release instead. A signed apt repository can replace this later.
- Publish `SHA256SUMS` plus a detached signature (minisign or GPG) for manual verification. Optional hardening for phase 4: embed an Ed25519 public key in the app, publish a signature over each Linux artifact, set `autoInstallOnAppQuit = false` and verify the signature on `update-downloaded` before calling `quitAndInstall()`. This binds Linux updates to our key instead of to whoever can upload release assets.
- Until then the README states that Linux updates are protected only by HTTPS and checksums from the same release, as spec 10 already says.
