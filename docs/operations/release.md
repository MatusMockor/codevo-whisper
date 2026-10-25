# Release pipeline

Spec section 10 and the recommendations in `docs/spikes/signed-update.md`. Workflow: `.github/workflows/release.yml`. Repository: `MatusMockor/codevo-whisper`.

## Jobs

| Job | Runner | What it does |
|---|---|---|
| `version` | `ubuntu-latest` | `scripts/release/resolve-version.sh`: version from the `vX.Y.Z` tag or the `version` input, must be semver |
| `checks` | `macos-15` | `pnpm lint`, `pnpm typecheck`, `pnpm test` (includes the real input helper integration test) |
| `build-mac` (arm64) | `macos-15` | native build, sign, package, notarize, staple, gates, upload `mac-arm64` |
| `build-mac` (x64) | `macos-15-intel` | same for Intel, upload `mac-x64` |
| `publish` | `ubuntu-latest` | merge `latest-mac.yml`, verify, draft release, re-verify from the draft, publish |

`publish` runs only after both `build-mac` jobs succeeded, and only for a tag push or a manual run with `publish: true`. `build-mac` needs `checks`, so lint, typecheck and tests gate everything.

`macos-13` (the last Intel image) was retired by GitHub in December 2025; `macos-15-intel` is the Intel x64 label GitHub announced as the last Intel macOS image. If it disappears, the fallback from the spike is to build x64 on the arm64 runner (`--x64` cross-build works, see `docs/spikes/signed-update.md`), at the cost of no native x64 run in CI.

Steps of one `build-mac` job:

1. `scripts/release/import-certificate.sh`: decodes `CSC_LINK` into a temporary keychain in `$RUNNER_TEMP` and puts it into the search list.
2. `scripts/release/write-api-key.sh`: writes the `.p8` from `APPLE_API_KEY` to `$RUNNER_TEMP/AuthKey.p8` (mode 0600) and exports its path as `APPLE_API_KEY` for `notarytool`.
3. `scripts/release/build-native.sh <arch>` and `scripts/release/sign-native.sh <arch>`: input helper and transcribe-cli, hardened runtime, timestamp, identifiers `app.codevo.whisper.input-helper` / `app.codevo.whisper.transcribe-cli`.
4. `pnpm --filter @codevo-whisper/desktop build`.
5. `scripts/release/package-app.sh <arch> <version>`: `electron-builder --mac zip --<arch> --publish never` into `apps/desktop/release/stage/<arch>`. The `zip` target (not `dir`) is required because electron-builder only writes `Contents/Resources/app-update.yml` (the electron-updater GitHub config) when a `dmg` or `zip` target is packed. The stage ZIP itself is discarded. Fuses are flipped and the app is signed here; signature and fuses are verified right away.
6. `scripts/release/notarize-app.sh`: zips the app with `ditto`, submits it, waits, staples and validates.
7. `scripts/release/package-distributables.sh <arch> <version>`: `electron-builder --mac dmg zip --prepackaged <stapled app>` into `apps/desktop/release/dist/<arch>`. `--prepackaged` neither re-signs nor re-notarizes, so the DMG and ZIP contain the stapled app (offline first launch works). `dmg.writeUpdateInfo: false` keeps `latest-mac.yml` to the ZIP only.
8. `scripts/release/notarize-dmg.sh`: submits, waits, staples and validates the DMG (electron-builder never notarizes DMGs).
9. Gates: `verify-signature.sh` (`codesign --verify --deep --strict`, identifiers, team, runtime, timestamp), `verify-notarization.sh` (`spctl --assess --type execute` must say `source=Notarized Developer ID`, `stapler validate` on app and DMG, `spctl --assess --type open --context context:primary-signature` on the DMG), `verify-fuses.ts` (fuse wire against `electronFuses` in `apps/desktop/electron-builder.yml`).
10. Upload `apps/desktop/release/dist/<arch>` (DMG, ZIP, ZIP blockmap, per-arch `latest-mac.yml`), then delete the keychain and the key file.

Artifact names: `codevo-whisper-${version}-${arch}-mac.{dmg,zip}`. The arch token is required by MacUpdater's file selection; x64 names never contain `arm64`.

## Workflow hardening

- Every `uses:` is pinned to a full commit SHA with a trailing `# vX.Y.Z` comment; `.github/dependabot.yml` proposes updates for the `github-actions` ecosystem weekly. Only first-party `actions/*` actions are used; pnpm comes from `corepack enable` (version from `packageManager`), not from a third-party action.
- `permissions: contents: read` for the workflow; only the `publish` job gets `contents: write`. Checkouts use `persist-credentials: false`.
- Secrets are exposed only as step-level `env` of the steps that need them: `CSC_LINK` / `CSC_KEY_PASSWORD` to the certificate import, `APPLE_API_KEY` to the key file step, `APPLE_API_KEY_ID` / `APPLE_API_ISSUER` to the two notarization steps, `GH_TOKEN` to the release step. The keychain and the key file are deleted at the end of each build job (`if: always()`).
- `APPLE_TEAM_ID` (variable) is the team `verify-signature.sh` requires on the app and both binaries (default `U574W69TH6`).

## Secrets and variables

Set once by the owner. The commands read the values from files or prompt for them, so nothing ends up in the shell history. Never commit or print the `.p12` or `.p8`.

```bash
repo=MatusMockor/codevo-whisper
base64 -i ~/Documents/certs/<developer-id>.p12 | gh secret set CSC_LINK --repo "$repo"
gh secret set CSC_KEY_PASSWORD --repo "$repo"
gh secret set APPLE_API_KEY --repo "$repo" < ~/Documents/certs/AuthKey_<KEY_ID>.p8
gh secret set APPLE_API_KEY_ID --repo "$repo"
gh secret set APPLE_API_ISSUER --repo "$repo"
gh variable set APPLE_TEAM_ID --repo "$repo" --body U574W69TH6
```

`gh secret set NAME` without `--body` prompts for the value. `CSC_LINK` holds the base64 encoded `.p12` (certificate and private key of `Developer ID Application: codevo s.r.o. (U574W69TH6)`), `APPLE_API_KEY` the content of the App Store Connect API key file, `APPLE_API_KEY_ID` its key ID, `APPLE_API_ISSUER` the issuer UUID from App Store Connect, Users and Access, Integrations.

## Cutting a release

1. `main` is green and contains everything for the release. Keep `apps/desktop/package.json` `version` in sync with the tag (the build overrides it with `-c.extraMetadata.version`, so a mismatch does not break the build).
2. Optional dry run without publishing: `gh workflow run release.yml -f version=1.2.0 -f publish=false`. It builds, signs, notarizes and gates both architectures and uploads the artifacts to the run.
3. Tag and push:

   ```bash
   git tag v1.2.0
   git push origin v1.2.0
   ```

4. Watch the run (`gh run watch`). The notary submission IDs are written to each build job's summary.
5. The release appears as published once `publish` finishes. A version with a pre-release suffix (`1.2.0-beta.1`) is published as a GitHub pre-release.

`publish-github-release.sh` refuses to run when a release for the tag already exists. To retry after a failed publish, delete the leftover draft (`gh release delete v1.2.0`) and re-run the failed jobs.

## How the update feed is merged

Each `build-mac` job writes its own `latest-mac.yml` listing only its own ZIP. Uploading both as-is would let the second one overwrite the first, and one architecture would silently stop updating. So build jobs never publish (`--publish never`), and the `publish` job:

1. downloads `mac-arm64` and `mac-x64`,
2. `scripts/release/assemble-mac-feed.sh`: copies DMGs, ZIPs and blockmaps into `feed/` and runs `scripts/release/merge-latest-mac.ts feed/latest-mac.yml <x64 manifest> <arm64 manifest>`. The merge refuses different versions, entries without `url`/`sha512`/integer `size`, and a result without a ZIP; it de-duplicates by `url`, keeps the latest `releaseDate`, and points the legacy top-level `path`/`sha512` to the x64 ZIP (what electron-builder writes in a single two-arch run),
3. `scripts/release/verify-feed.ts feed/latest-mac.yml`: re-hashes every listed file (size and sha512), requires a ZIP for both `arm64` and `x64`, rejects URLs that are not plain file names and a legacy `path` that does not match a listed file,
4. creates a draft release with all files, downloads every asset of the draft again into a temp dir and runs `verify-feed.ts` on it,
5. publishes the draft. Publishing is the single atomic switch: until then no client sees the new version.

MacUpdater on Apple silicon keeps only URLs containing `arm64` (also for an x64 build under Rosetta, which migrates it to arm64); on Intel it drops them. Both ZIPs in one manifest are therefore required.

Local check of a feed: `node scripts/release/verify-feed.ts <dir>/latest-mac.yml`.

## Notarization latency

Apple's notarization latency is not bounded. The first submissions of team U574W69TH6 (phase 0 spike, 2026-10-25) have been `In Progress` for more than 6 hours. Until Apple has accepted the first submissions, a release run will most likely time out in notarization.

How the pipeline deals with it:

- `notary-submit.sh` submits with `--no-wait`, prints the submission ID and adds it to the job summary, then `notary-wait.sh` waits with `notarytool wait --timeout $NOTARY_TIMEOUT` (150 minutes per submission in CI) and checks that the final status is `Accepted` (prints the notary log otherwise).
- The build jobs have `timeout-minutes: 360`, the maximum for GitHub-hosted runners. App and DMG are two sequential submissions per job.
- On a timeout the job fails with the submission ID and the resume command (`scripts/release/notary-wait.sh <id>`). A re-run of the job builds a new bundle with a new cdhash, so it must be submitted again; the old submission only helps to watch when Apple's queue moves (`xcrun notarytool history`, `xcrun notarytool info <id>` with the API key options).
- Before the first tag, check that the spike submissions listed in `docs/spikes/signed-update.md` are `Accepted`, then do a `publish=false` dry run.

## Local dry run of the CI packaging

On the owner's Mac, without notarization:

```bash
scripts/release/build-native.sh arm64
scripts/release/sign-native.sh arm64
pnpm --filter @codevo-whisper/desktop build
scripts/release/package-app.sh arm64 0.0.1
scripts/release/package-distributables.sh arm64 0.0.1
```

With the API key in the environment (`APPLE_API_KEY` = path to the `.p8`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`) the notarization scripts can be run by hand between the two packaging steps.

## Linux

`.github/workflows/release-linux.yml` is a separate, manual-only workflow (`workflow_dispatch`) whose only job runs when the `enabled` input is true; the input defaults to false, so the workflow does nothing until Linux support lands in phase 4. When enabled it runs the checks, builds AppImage and deb for x64 (`ubuntu-24.04`) and arm64 (`ubuntu-24.04-arm`) with `--publish never`, writes `SHA256SUMS-linux-<arch>` and uploads `latest-linux.yml` / `latest-linux-arm64.yml` with the packages as run artifacts. It does not attach anything to a release yet.

Not ready before phase 4: there is no Linux transcribe-cli or input helper build (`resources/bin/<arch>` is empty on Linux), and the update policy from spec 10 still applies: in-app auto-update only for the AppImage (verified by HTTPS and the sha512 from the same feed, no publisher signature), deb users get a notice with a download link.

## Not covered yet

- electron-updater wiring in the app (later integration stream). The packaged app already contains `app-update.yml` for the GitHub provider.
- N -> N+1 update test with the hardened fuses (spec 10) once the first notarized release exists.
- Server images to GHCR (spec 10) once the server exists (phase 2).
