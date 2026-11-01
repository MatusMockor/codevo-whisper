# CODWHI-16 pairing cancellation merge fix

This fixes PR13 thread `PRRT_kwDOVZZW2s6yVQFO` on the current PR17 branch, `fix/codwhi-20-mobile-keyboard-fit`. The starting commit is `a54efabad72589751565e97ff8f1c4fa340a3e94`. Earlier stack branches remain unchanged. The parent owns fresh independent gpt-6.1-sol review and merging.

## Behavior and scope

`pairDevice` previously checked cancellation before the asynchronous protected write, then returned success unconditionally. Cancel or background during that write replaced the prior pairing and still reported success.

After the write settles successfully, `pairDevice` checks cancellation again. If aborted, it awaits restoration of the exact prior serialized value, or removes the new value for a first pairing, then throws `Pairing cancelled`. Save, restore, and removal errors propagate unchanged. A failed restore does not report successful preservation. The protected-storage ABI, Noise handshake, operator approval, and key pinning are unchanged. No dependency was added.

The existing UI disables another pairing or removal while pairing is busy and clears busy only after `pairDevice` settles. The rollback remains inside that interval. No concurrent-pair transaction framework was added.

The data shape remains the existing protected `string | null` snapshot. Keeping the guard in the owning operation follows Model the Domain without adding state or a new abstraction.

## Public regression evidence

The tests call public `pairDevice` through the real WebSocket gateway, Noise handshake, and operator approval. Only native vault scheduling and storage failure are controlled. The test holds the initial write, aborts, then completes the write. It observes the returned outcome and reloads the vault. Assertions compare preservation as a boolean so failure output cannot print credentials.

The initial regressions were committed before the production fix in `cf710c6`. Both first pairing and replacement failed on the starting implementation. The two existing approval, rejection, and server-key tests passed.

```text
AssertionError: expected 'approved' to match object { message: 'Pairing cancelled' }
AssertionError: expected false to be true // Object.is equality
Tests  2 failed | 2 passed (4)
```

The final focused run passes nine tests. These include both cancellation modes with working storage, initial save failure, restore or removal failure, and cancellation from the approval callback. Existing failed-approval and key-pinning tests remain unchanged. [Red output](codwhi-16-merge-fix/red.txt), [final focused output](codwhi-16-merge-fix/green.txt), and [broader output](codwhi-16-merge-fix/tests.txt) are retained.

## Commands and results

Commands ran from `/home/matcer/.t3/worktrees/codevo-whisper/t3-d806b355`.

```sh
pnpm --filter @codevo-whisper/server exec vitest run test/mobile-client.test.ts
buildq pnpm exec vitest run --project mobile --project server
pnpm --filter @codevo-whisper/mobile typecheck
pnpm --filter @codevo-whisper/server typecheck
pnpm exec eslint apps/mobile/src/core/pairing.ts apps/server/test/mobile-client.test.ts
source scripts/mobile/android-env.sh
buildq apps/mobile/android/gradlew -p apps/mobile/android :app:assembleVerification --no-daemon --max-workers=6
"$ANDROID_HOME/build-tools/37.0.0/apksigner" verify apps/mobile/android/app/build/outputs/apk/verification/app-verification.apk
git diff --check
```

Final mobile and server suites pass 166 tests in 20 files. Both typechecks and scoped ESLint pass. Gradle assembles the verification APK successfully with bundled Hermes bytecode. ZIP integrity and APK signature verification pass. Gradle reports deprecated features that are incompatible with Gradle 10. Native geometry is unchanged and its matrix was not rerun. The parent owns any full-repository final check.

## Source and artifact

[Artifact metadata](codwhi-16-merge-fix/artifact.json) records SHA-256 fingerprints for the exact tested pairing source and gateway test, APK, and bundled bytecode. It identifies the source delta against `a54efab` without a self-referential commit hash. The task proof revision carries the final commit SHA.

- Pairing source SHA-256 `9922cc9d2eb54c4da8c505659defb8d1cf3d9d9e3339b1ff92c292affff3fd9d`.
- Verification APK `apps/mobile/android/app/build/outputs/apk/verification/app-verification.apk`.
- APK SHA-256 `0589ad53414909f05c1dc664f514707ae176f2e3fee60fa18493b651c2956e64`.
- `assets/index.android.bundle` contains 1,372,188 bytes of Hermes bytecode. Its magic is `c61fbc03c103191f` and SHA-256 is `ca74d5a0c06d1a6be55f781967d21104a9a9613ec384f94c4599b3d2715e6d8e`.

The phone remains on the previously installed `a54efab` source reported by the parent. This narrow merge-fix request did not update it. No phone, emulator, persistent server, or Tailscale action ran. Gateway servers were isolated test harnesses and were closed by test cleanup. No physical timing or Apple runtime validation is claimed.

The worker performed no independent review, PR comments, PR monitoring, merges, or task completion. Review and trail review are deferred to the parent under the explicit no-delegation instruction. [The existing decision trail](codwhi-16-decisions.tsv) records this run under its new `start` row.
