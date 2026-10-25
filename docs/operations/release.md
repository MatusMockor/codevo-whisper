# Release pipeline

Spec section 10 and the recommendations in `docs/spikes/signed-update.md`. Workflow: `.github/workflows/release.yml`. Repository: `MatusMockor/codevo-whisper`.

## Jobs

| Job | Runner | Environment | What it does |
|---|---|---|---|
| `version` | `ubuntu-latest` | - | `verify-build-ref.sh` (see Signing protection), `resolve-version.sh`: version from the `vX.Y.Z` tag or the `version` input, must be semver |
| `checks` | `macos-15` | - | `pnpm lint`, `pnpm typecheck`, `pnpm test` (includes the real input helper integration test) |
| `build-mac` (arm64) | `macos-15` | `release` | native build, sign, package, notarize, staple, gates, upload `mac-arm64` |
| `build-mac` (x64) | `macos-15-intel` | `release` | same for Intel, upload `mac-x64` |
| `publish` | `ubuntu-latest` | `release` | merge `latest-mac.yml`, verify, draft release, re-verify every asset of the draft, publish |

Triggers:

- Tag push `v*.*.*`: full release, `publish` runs after both `build-mac` jobs succeeded.
- Manual run (`workflow_dispatch`, input `version`): only from `main` (the `version` job is skipped for any other ref, so nothing else runs). Builds, signs, notarizes and verifies both architectures and uploads the artifacts to the run; never publishes. Publishing always needs a tag (`gh release create --verify-tag`).
- Runs for the same version share the concurrency group `release-v<version>` and never cancel each other.

`macos-13` (the last Intel image) was retired by GitHub in December 2025; `macos-15-intel` is the Intel x64 label GitHub announced as the last Intel macOS image. If it disappears, the fallback from the spike is to build x64 on the arm64 runner (`--x64` cross-build works, see `docs/spikes/signed-update.md`), at the cost of no native x64 run in CI.

Steps of one `build-mac` job:

1. `verify-build-ref.sh` again (the job checks out with full history).
2. Restore the notary state of an earlier attempt of the same run, if any (see Notarization latency and resume). `notary-state-restore.sh` prints the resume phase: `none`, `app-submitted` or `dmg-submitted`, and refuses to resume when a saved file does not match its recorded sha256.
3. Phase `none` only, before any secret is loaded: `build-native.sh <arch>` (input helper and transcribe-cli, both with deployment target macOS 13.0) and the electron-vite desktop build.
4. `import-certificate.sh` (skipped in phase `dmg-submitted`): decodes `CSC_LINK` in a private temp dir (umask 077, deleted on exit) into a temporary keychain in `$RUNNER_TEMP` and checks that the identity is `Developer ID Application: codevo s.r.o. (U574W69TH6)`.
5. Phase `none`: `sign-native.sh <arch>` (hardened runtime, timestamp, identifiers `app.codevo.whisper.input-helper` / `app.codevo.whisper.transcribe-cli`), then `package-app.sh <arch> <version>`: `electron-builder --mac zip --<arch> --publish never` into `apps/desktop/release/stage/<arch>`. The `zip` target (not `dir`) is required because electron-builder only writes `Contents/Resources/app-update.yml` (the electron-updater GitHub config) when a `dmg` or `zip` target is packed; the stage ZIP is discarded. Fuses are flipped and the app is signed here; signature, bundled binaries and fuses are verified right away.
6. Phase `none`: `submit-app.sh` zips the exact signed app into the notary state, submits it (`--no-wait`) and records the submission ID with the sha256 of the ZIP; the state is uploaded as the artifact `notary-state-<arch>`.
7. `staple-app.sh`: waits for the app submission, staples and validates the app.
8. `package-distributables.sh <arch> <version>`: `electron-builder --mac dmg zip --prepackaged <stapled app>` into `apps/desktop/release/dist/<arch>`. `--prepackaged` neither re-signs nor re-notarizes, so the DMG and ZIP contain the stapled app (offline first launch works). `dmg.writeUpdateInfo: false` keeps `latest-mac.yml` to the ZIP only.
9. `submit-dmg.sh`: copies the dist files into the notary state, submits the DMG, records the submission ID and the sha256 of every dist file, uploads the state again.
10. `staple-dmg.sh`: waits for the DMG submission, staples and validates the DMG.
11. `verify-shipped.sh <arch> <version>`: the gates run on what ships, not on the stage app. It extracts the dist ZIP with `ditto -x -k` and mounts the DMG read-only (`hdiutil attach -nobrowse -noautoopen`), and on both copies of the app runs `verify-signature.sh` (`codesign --verify --deep --strict`, identifiers, team, hardened runtime, timestamp), `verify-binaries.sh` (every Mach-O in `Contents/Resources/bin/<arch>` has the arch slice via `lipo -verify_arch` and `vtool -show-build` minos <= 13.0), `verify-fuses.ts` (fuse wire against `electronFuses` in `apps/desktop/electron-builder.yml`) and `stapler validate`; then `verify-notarization.sh` (`spctl --assess --type execute` must say `source=Notarized Developer ID`, `stapler validate` on app and DMG, `spctl --assess --type open --context context:primary-signature` on the DMG).
12. Upload `apps/desktop/release/dist/<arch>` (DMG, ZIP, ZIP blockmap, per-arch `latest-mac.yml`) as `mac-<arch>`, then delete the keychain (`if: always()`).

The App Store Connect key never touches the workspace or `$GITHUB_ENV`: `with-api-key.sh` writes it to a private temp dir only for the duration of one notarization step and deletes it on exit.

Artifact names: `codevo-whisper-${version}-${arch}-mac.{dmg,zip}`. The arch token is required by MacUpdater's file selection; x64 names never contain `arm64`.

## Signing protection

- `build-mac` and `publish` run in the GitHub environment `release`; the signing and notarization secrets live in that environment, not in the repository, so no other workflow or job can read them.
- `verify-build-ref.sh` runs in `version` and before anything is built in `build-mac`: for a tag run the dereferenced tag commit must equal the build SHA, for a manual run the ref must be `main`, and in both cases the build commit must be on `main`.
- `publish-github-release.sh` checks again that the tag (dereferenced through the GitHub API) points to the build SHA, that `latest-mac.yml` has the release version, and creates the release with `--verify-tag`.
- Every `uses:` is pinned to a full commit SHA with a trailing `# vX.Y.Z` comment; `.github/dependabot.yml` proposes updates for the `github-actions` ecosystem weekly. Only first-party `actions/*` actions are used; pnpm comes from `corepack enable` (version from `packageManager`).
- `permissions: contents: read` for the workflow; only `publish` gets `contents: write`. Checkouts use `persist-credentials: false`.
- Secrets are only step-level `env` of the steps that need them: `CSC_LINK` / `CSC_KEY_PASSWORD` for the certificate import, `APPLE_API_KEY` / `APPLE_API_KEY_ID` / `APPLE_API_ISSUER` for the four notarization steps, `GH_TOKEN` for the release step. Native and desktop builds (the steps that run third-party build code: transcribe.cpp, npm packages) run before the certificate is imported.

### One-time GitHub setup (owner)

1. Settings, Environments, New environment `release`:
   - Required reviewers: the owner (`MatusMockor`). Every run that reaches `build-mac` or `publish` waits for approval.
   - Deployment branches and tags: "Selected branches and tags", rules `main` (branch) and `v*` (tag).
   - Environment secrets: the five secrets below. Environment variable `APPLE_TEAM_ID`.
2. Settings, Rules, Rulesets, New tag ruleset `release tags`: target tags matching `v*`, enforcement active, rules "Restrict creations", "Restrict updates", "Restrict deletions", "Block force pushes"; bypass list: the owner only. Only the owner can then create or move a release tag.
3. Delete any repository-level copies of the signing secrets once the environment secrets exist (`gh secret list --repo MatusMockor/codevo-whisper`).

## Secrets and variables

Set once by the owner into the `release` environment. The commands read the values from files or prompt for them, so nothing ends up in the shell history. Never commit or print the `.p12` or `.p8`.

```bash
repo=MatusMockor/codevo-whisper
base64 -i ~/Documents/certs/<developer-id>.p12 | gh secret set CSC_LINK --repo "$repo" --env release
gh secret set CSC_KEY_PASSWORD --repo "$repo" --env release
gh secret set APPLE_API_KEY --repo "$repo" --env release < ~/Documents/certs/AuthKey_<KEY_ID>.p8
gh secret set APPLE_API_KEY_ID --repo "$repo" --env release
gh secret set APPLE_API_ISSUER --repo "$repo" --env release
gh variable set APPLE_TEAM_ID --repo "$repo" --env release --body U574W69TH6
```

`gh secret set NAME` without `--body` prompts for the value. `CSC_LINK` holds the base64 encoded `.p12` (certificate and private key of `Developer ID Application: codevo s.r.o. (U574W69TH6)`), `APPLE_API_KEY` the content of the App Store Connect API key file, `APPLE_API_KEY_ID` its key ID, `APPLE_API_ISSUER` the issuer UUID from App Store Connect, Users and Access, Integrations. `APPLE_TEAM_ID` is the team `verify-signature.sh` requires on the app and both binaries (default `U574W69TH6`).

## Cutting a release

1. `main` is green and contains everything for the release. Keep `apps/desktop/package.json` `version` in sync with the tag (the build overrides it with `-c.extraMetadata.version`, so a mismatch does not break the build).
2. Optional dry run without publishing: `gh workflow run release.yml --ref main -f version=1.2.0`. Approve the `release` environment when asked.
3. Tag the commit on `main` and push the tag:

   ```bash
   git tag -a v1.2.0 -m "Codevo Whisper 1.2.0"
   git push origin v1.2.0
   ```

4. Approve the `release` environment for `build-mac` and later for `publish`, watch the run (`gh run watch`). Notary submission IDs are in each build job's summary.
5. The release appears as published once `publish` finishes. A version with a pre-release suffix (`1.2.0-beta.1`) is published as a GitHub pre-release.

`publish-github-release.sh` refuses to run when a release for the tag already exists. To retry after a failed publish, delete the leftover draft (`gh release delete v1.2.0`) and re-run the failed job.

## How the update feed is merged

Each `build-mac` job writes its own `latest-mac.yml` listing only its own ZIP. Uploading both as-is would let the second one overwrite the first, and one architecture would silently stop updating. So build jobs never publish (`--publish never`), and the `publish` job:

1. downloads `mac-arm64` and `mac-x64`,
2. `assemble-mac-feed.sh`: copies DMGs, ZIPs and blockmaps into `feed/` and runs `merge-latest-mac.ts feed/latest-mac.yml <x64 manifest> <arm64 manifest>`. The merge refuses different versions, entries without `url`/`sha512`/integer `size`, and a result without a ZIP; it de-duplicates by `url`, keeps the latest `releaseDate`, and points the legacy top-level `path`/`sha512` to the x64 ZIP (what electron-builder writes in a single two-arch run),
3. `verify-feed.ts feed/latest-mac.yml <version>`: the manifest version must be the release version; re-hashes every listed file (size and sha512), requires a ZIP for both `arm64` and `x64`, rejects URLs that are not plain file names and a legacy `path` that does not match a listed file,
4. `publish-github-release.sh`: checks the tag commit, creates a draft release with every file of `feed/`, downloads every asset of the draft into a temp dir and runs `verify-release-assets.ts` (the exact same file list and the same sha256 for every DMG, ZIP, blockmap and `latest-mac.yml`) and `verify-feed.ts` on the downloaded copy,
5. publishes the draft. Publishing is the single atomic switch: until then no client sees the new version.

MacUpdater on Apple silicon keeps only URLs containing `arm64` (also for an x64 build under Rosetta, which migrates it to arm64); on Intel it drops them. Both ZIPs in one manifest are therefore required.

Local check of a feed: `node scripts/release/verify-feed.ts <dir>/latest-mac.yml [version]`.

## Notarization latency and resume

Apple's notarization latency is not bounded. The first submissions of team U574W69TH6 (phase 0 spike, 2026-10-25) have been `In Progress` for more than 6 hours. Until Apple has accepted the first submissions, a release run will most likely time out in notarization.

- `notary-submit.sh` submits with `--no-wait`, prints the submission ID and adds it to the job summary. The exact submitted file and the ID are saved in the artifact `notary-state-<arch>` before waiting starts.
- `notary-wait.sh` waits with `notarytool wait --timeout $NOTARY_TIMEOUT` (150 minutes per submission in CI), then reads `notarytool info`: `Accepted` passes; `In Progress` exits with code 75 and says to re-run; any other status (`Invalid`, `Rejected`) prints the info and the notary log and fails.
- Build jobs have `timeout-minutes: 360`, the maximum for GitHub-hosted runners.
- Resume: "Re-run failed jobs" on the same workflow run. The re-run downloads `notary-state-<arch>` from the earlier attempt, verifies the sha256 of every saved file, and continues from the saved phase without rebuilding or re-signing: in `app-submitted` it unpacks the exact signed app that was submitted, waits for the same submission and staples; in `dmg-submitted` it restores the exact DMG/ZIP set and only waits and staples the DMG. A new run (or a new tag push) starts from scratch with a new bundle and a new submission.
- Manual fallback: download the `notary-state-<arch>` artifact, check the submission with `xcrun notarytool info <id> --key <p8> --key-id <id> --issuer <issuer>`.
- Before the first tag, check that the spike submissions listed in `docs/spikes/signed-update.md` are `Accepted`, then do a manual dry run.

## Local dry run of the CI packaging

On the owner's Mac, without notarization:

```bash
scripts/release/build-native.sh arm64
scripts/release/sign-native.sh arm64
pnpm --filter @codevo-whisper/desktop build
scripts/release/package-app.sh arm64 0.0.1
scripts/release/package-distributables.sh arm64 0.0.1
REQUIRE_NOTARIZATION=0 scripts/release/verify-shipped.sh arm64 0.0.1
```

With the API key available (`APPLE_API_KEY_CONTENT` for `with-api-key.sh`, or `APPLE_API_KEY` as a path, plus `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`), `scripts/release/notarize-app.sh` and `scripts/release/notarize-dmg.sh` notarize and staple by hand.

## Linux

`.github/workflows/release-linux.yml` is a separate, manual-only workflow (`workflow_dispatch`) whose only job runs when the `enabled` input is true; the input defaults to false, so the workflow does nothing until Linux support lands in phase 4. When enabled it runs the checks, builds AppImage and deb for x64 (`ubuntu-24.04`) and arm64 (`ubuntu-24.04-arm`) with `--publish never`, writes `SHA256SUMS-linux-<arch>` and uploads `latest-linux.yml` / `latest-linux-arm64.yml` with the packages as run artifacts. It does not sign anything and does not attach anything to a release yet.

Not ready before phase 4: there is no Linux transcribe-cli or input helper build (`resources/bin/<arch>` is empty on Linux), and the update policy from spec 10 still applies: in-app auto-update only for the AppImage (verified by HTTPS and the sha512 from the same feed, no publisher signature), deb users get a notice with a download link.

## Not covered yet

- electron-updater wiring in the app and the N -> N+1 update test with the final fuses (spec 10). Release-blocking; planned as a later integration task. The packaged app already contains `app-update.yml` for the GitHub provider.
- Linux release jobs (phase 4) and server images to GHCR (phase 2, spec 10).
