# macOS release blocker fixes

Goal: resolve and verify issues #53, #54 and #55 before closing them; reduce the reported dependency audit findings without unrelated upgrades.

The regression spec is `docs/reports/codwhi-43-proof.md` and the native acceptance cases in `apps/desktop/e2e/macos-native.spec.ts`. Keep all capture, caret, app identity, secure-input, and per-posting guards. Do not replace a failing assertion with a skip.

1. Reproduce native locked delivery and overlay cancellation failures with the existing opt-in macOS tests. Inspect AppKit key-window state and native AX focus; test minimal native/window readiness fixes against actual typing and focus return. Keep native desktop tests sequential. Parent owns native helper/overlay changes.
2. Reproduce #55's six tests, then make test platform and Codex filesystem isolation explicit. Verify both relevant platforms without weakening production discovery or collision checks. Test-isolation worker owns the three affected desktop test files and isolated test support.
3. Inspect the audit, update only affected dependency pins/compatible transitive overrides, and run scripts/feed tests plus audit again. Dependency worker owns manifests and lockfile; document any unpatched residual advisory.
4. Run warning-free arm64/x64 helper builds, native regressions, the full CI unit invocation, lint/typecheck and dependency audit. Review the combined diff. Update the report with new results, land the fixes and close only verified issue IDs.
