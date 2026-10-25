# Spike: macOS hotkey -> overlay -> paste

Phase 0, Task 1 (`docs/plans/2026-10-25-phase-0-spikes.md`). Spec sections 5.1-5.3.

Status: built and self-tested without a human. The interactive protocol below (key holding, lock, sleep, focus, fullscreen, Spaces, password field) is still open. The "Results" section is filled in after the interactive session.

## What was built

`spikes/macos-input/` is a standalone Electron 45.0.0 app (TypeScript 7.0.2, Node 24, pnpm 10.34.5) plus a Swift 6.4 helper.

| Part | Files | What it does |
|---|---|---|
| Swift helper | `helper/Sources/*.swift`, `helper/build.sh` -> `helper/build/codevo-input-helper` | One binary, three modes. `serve` (used by the app): JSON-lines RPC over stdin/stdout plus key events. `listen [keycodes]`: standalone listen-only `CGEventTap` that prints `{"event":"down"\|"up","keycode":n,"ts":ms,"flags":n}`. `cmd <name>`: one-shot command for manual checks. |
| Helper commands | `Commands.swift` | `ping`, `permissions` (`CGPreflightListenEventAccess`, `CGPreflightPostEventAccess`, `AXIsProcessTrusted`), `request-permission`, `frontmost` (`NSWorkspace.frontmostApplication` plus the top layer-0 window id of that app), `secure-input` (`IsSecureEventInputEnabled` plus `kCGSSessionSecureInputPID` from `IOConsoleUsers`), `clipboard-save` / `clipboard-write` / `clipboard-restore` (full-fidelity `NSPasteboard` save of every item and type, restore only if `changeCount` and text are unchanged), `paste` (CGEvent Cmd+V to `.cghidEventTap`), `listen-start` / `listen-stop`. |
| Key detection | `KeyTap.swift` | Listen-only session tap on `flagsChanged`. Down/up comes from the device-specific flag bit: left Option 58 -> `0x20`, right Option 61 -> `0x40`, Fn 63 -> `0x800000`. No dedupe, so a lost up is corrected by the next press. Re-enables the tap on `tapDisabledByTimeout` / `tapDisabledByUserInput` and logs `tap-reenabled`. |
| Hotkey candidates | `src/main/hotkey/` | Strategy `HotkeySource` with `SwiftTapSource` (helper) and `UiohookSource` (`uiohook-napi` 1.5.5 in main). `HotkeyRouter` sends only the active candidate to the session. With "Also log the other candidate" on, both run and the other one is logged with `active:false` so the two can be compared. |
| Session | `src/main/session/DictationSession.ts` | `idle -> recording -> transcribing -> inserting -> result -> idle`. Key-down captures the frontmost app and shows the overlay. Key-up waits the simulated transcription time (default 1000 ms), then runs the paste flow. |
| Reset rule | `src/main/session/ResetGuard.ts` | A session ends after the push-to-talk maximum (default 120000 ms, configurable) or on `powerMonitor` `lock-screen` / `suspend`. `unlock-screen`, `resume`, `shutdown` and `user-did-*` are logged too. After a reset a late key-up is ignored and the next key-down starts a new session. |
| Paste flow | `src/main/paste/` | Focus check (pid, plus window id if "compare window id" is on) -> `IsSecureEventInputEnabled` (if on: clipboard fallback, no paste, no restore) -> save clipboard -> write text (optionally marked `org.nspasteboard.TransientType`) -> Cmd+V -> restore after the configurable delay, only if unchanged. A pending restore is flushed before the next paste so a quick second dictation never saves the inserted text as the user's clipboard. |
| Overlay | `src/main/windows/OverlayWindow.ts`, `src/renderer/overlay.*` | `BrowserWindow` with `type:'panel'`, `focusable:false`, `frame:false`, `transparent:true`, `hasShadow:false`, `skipTaskbar`, `hiddenInMissionControl`, `setAlwaysOnTop(true,'screen-saver')`, `setVisibleOnAllWorkspaces(true,{visibleOnFullScreen:true, skipTransformProcessType})`, shown with `showInactive()` at bottom-center of the work area of the display under the cursor (560x132, 28 px margin). Shows key state, candidate, session state, elapsed time, a fake streaming Slovak transcript, the outcome, and a "Kopírovať" button when nothing was pasted. |
| Self-reporting | `src/main/session/OverlayFocusAudit.ts` | 300 ms after every overlay show (and after a "Kopírovať" click) it logs `overlay-focus-check` with the expected and actual frontmost app, `overlayVisible` and `overlayFocused`. `app-activation` is logged whenever Electron becomes or stops being the active app, so a stolen focus shows up in the log. |
| Control window | `src/renderer/control.*` | Permission status, source status, all settings, buttons (request permission, open System Settings pane, delayed overlay test, simulated press, restart helper, reveal log), a paste-target textarea and a live log tail. |
| Self-test | `src/main/selftest/` | `pnpm selftest`: automated checks that need no key presses and no permissions (see "Verified without a human"). |

The test text pasted by every session is `Codevo test <n>: ahoj, toto je skúška prepisu ľščťžýáíé. ` (session number plus diacritics, so you can tell which session landed where and whether Unicode survives).

## How to run

```bash
cd spikes/macos-input
pnpm install
pnpm start                 # compile helper + TS, launch via LaunchServices (open -n Electron.app)
pnpm start --no-hotkeys    # same, without starting any event tap (no permission prompts)
pnpm start:direct          # electron . from the current terminal (TCC goes to the terminal app)
pnpm selftest              # automated checks, exits 0 on pass
pnpm stop                  # quit the running spike instance
pnpm log                   # tail -f the JSONL log
pnpm log:summary [runId|last] [type ...]   # compact view of one run, optionally filtered by type
pnpm typecheck
```

Notes:
- Electron 45 downloads its binary on first use, not on `pnpm install`. `scripts/start.sh` runs `node node_modules/electron/install.js` if `dist/` is missing.
- Shells inside Electron-based tools (T3 Code, VS Code) export `ELECTRON_RUN_AS_NODE=1`, which makes `electron .` run as plain Node (`app` is undefined). All scripts unset it.
- `pnpm start` launches via LaunchServices on purpose. TCC then treats `Electron.app` (`com.github.Electron`) as the responsible app, and the helper child inherits that. With `pnpm start:direct` the responsible app is the terminal the command was run from, so prompts and grants go to that terminal app, not to Electron. The product will have the same rule: the helper must live inside the signed app bundle and be spawned by it.
- The run id is shown in the control window and written into every log line. The log file is shared across runs.

## Required permissions

| Permission | Needed by | System Settings path | Deep link |
|---|---|---|---|
| Input Monitoring | Swift helper candidate (listen-only `CGEventTap`) | System Settings > Privacy & Security > Input Monitoring > "Electron" | `x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent` |
| Accessibility | `uiohook-napi` candidate (libuiohook checks `AXIsProcessTrustedWithOptions` with prompt and uses an active, not listen-only, session tap); Cmd+V via `CGEventPost` for both candidates | System Settings > Privacy & Security > Accessibility > "Electron" | `x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility` |

- Expected prompt texts (not captured yet, confirm in T0.1 / T0.3): Input Monitoring: "“Electron” would like to receive keystrokes from any application." Accessibility: "“Electron” would like to control this computer using accessibility features." Both are expected to offer "Open System Settings" and "Deny".
- The dev `Electron.app` is ad-hoc signed (`TeamIdentifier=not set`), and so is the helper (`adhoc,linker-signed`). TCC grants for ad-hoc binaries are tied to the code hash, so an Electron upgrade or reinstall can silently invalidate them. Signed behaviour is out of scope here and goes with the Task 4 signed build.
- Current state on the dev Mac (2026-10-25): no grant for Electron (`listenEvent:false`, `postEvent:false`, `accessibility:false`). No permission was granted or requested during the automated verification.

## Verified without a human (2026-10-25, macOS 26.6.2, arm64)

| Check | Evidence |
|---|---|
| Swift helper compiles in Swift 6 language mode with no warnings (`-swift-version 6`, target macOS 13) | `helper/build.sh` |
| Helper one-shot and `serve` RPC work: `ping`, `permissions`, `frontmost`, `secure-input`, `clipboard-changecount`, unknown command and invalid JSON handling | manual run |
| `NSWorkspace.frontmostApplication` stays fresh in the long-running `serve` process (Finder, then Chrome, detected after `open -a`); RPC round trip is about 3 ms after warm-up, 34 ms for the first call | manual run |
| Helper clipboard round trip is full fidelity: a `public.png` clipboard was saved, replaced with text, and restored byte-identical; restore is refused with `changecount-changed` after an external `pbcopy` | manual run |
| `pnpm typecheck` passes (main/preload and renderer projects, strict, `exactOptionalPropertyTypes`) | |
| `uiohook-napi` prebuilt N-API binary loads in Electron 45 main without a rebuild | app starts with `UiohookSource` constructed |
| `pnpm start` (LaunchServices) launches the app; the helper runs as a child of Electron; the log is written | run `0b340473` |
| `pnpm selftest` passes 20/20 checks (one info check), run `985cab70` | see below |

Self-test checks (all pass): helper permission query; secure input query returns `enabled:false`; Finder can be made frontmost; overlay `showInactive()` while Finder is frontmost keeps Finder frontmost (`overlay-focus-check focusKept:true`, no `app-activation` event), overlay `isVisible()` true and `isFocused()` false; overlay renderer shows the pushed state; control window renders its status; simulated session with Finder as target and Electron activated during the 1.5 s transcription -> `focus-check result:app-changed`, `paste-result kind:focus-changed`, no clipboard touched; simulated session with the same target -> clipboard saved, written, Cmd+V posted (`postAccess:false`, so nothing landed, as expected without Accessibility), clipboard restored after 300 ms (`restored:true`); max-duration reset at 1.5 s, late key-up ignored, next press starts a new session; reset on emitted `lock-screen` and `suspend`, each followed by a successful new session.

Not verifiable without a human or without permissions: real key events from either candidate, the actual permission prompts, the paste landing in an app, behaviour over fullscreen apps and Spaces, real lock / sleep, secure input in a real password field. Screen capture from the agent shell also failed (no Screen Recording grant), so nothing visual has been checked yet.

## Findings so far (static, from source)

- `uiohook-napi` 1.5.5 (libuiohook) cannot report Fn: `kVK_Function` (63) maps to `VC_UNDEFINED` and the modifier handler has no Fn branch. With key "Fn" the uiohook source reports `uiohook-has-no-keycode-for-fn`.
- libuiohook tracks Option with the generic `kCGEventFlagMaskAlternate`, so with both Options held, releasing one is not reported as up. The Swift helper uses the device-specific bits and has no such issue.
- libuiohook installs an active (`kCGEventTapOptionDefault`) session tap and requires Accessibility, which is broader than the Input Monitoring a listen-only tap needs. The Swift helper uses `.listenOnly`.
- A listen-only tap cannot swallow events, so Fn bound to the emoji picker or to dictation will still trigger that system action. Suppressing it would need an active tap (Accessibility) and may not work for the Globe key at all (T1.3).

## Log

File: `~/Library/Logs/CodevoWhisperSpike/macos-input.jsonl`. One JSON object per line: `ts` (ISO), `t` (epoch ms), `runId`, `type`, plus fields.

| type | When | Key fields |
|---|---|---|
| `app-start`, `helper-ready`, `hotkeys-enabled`, `app-quit` | lifecycle | `pid`, `execPath`, `enabled` |
| `permissions` | on change (polled every 3 s) | `helper.listenEvent`, `helper.postEvent`, `helper.accessibility`, `electronAccessibility` |
| `hotkey-source` | candidate started | `source`, `key`, `active`, `running`, `error` |
| `helper-event` | helper non-key events | `event: tap-error \| tap-reenabled`, `reason` |
| `key-down`, `key-up` | every raw key event | `source: swift \| uiohook \| simulated`, `keycode`, `eventTs`, `active` |
| `session-start`, `target-captured`, `session-release`, `session-end` | session lifecycle | `sessionId`, `target.bundleId`, `target.pid`, `target.window.windowId`, `heldMs` |
| `down-ignored`, `up-ignored` | key event that does not fit the state | `state`, `sessionId` |
| `overlay-shown`, `overlay-hidden`, `overlay-recreated` | overlay | `displayId`, `bounds`, `visible`, `focused`, `skipTransformProcessType` |
| `overlay-focus-check` | 300 ms after each show / copy click | `context`, `expectedApp`, `actualApp`, `focusKept`, `overlayVisible`, `overlayFocused` |
| `app-activation` | Electron became (`active:true`) or stopped being active | `active` |
| `focus-check` | before paste | `result: same \| app-changed \| window-changed \| no-target`, `target`, `current` |
| `secure-input-check`, `secure-input-detected` | before paste | `enabled`, `pid` / `securePid`, `fallback: clipboard` |
| `clipboard-saved`, `clipboard-written` | paste flow | `items`, `types`, `changeCount`, `transient`, `text` |
| `paste-result` | outcome | `kind: pasted \| focus-changed \| secure-input \| error`, `posted`, `postAccess` |
| `clipboard-restore` | after the delay or flush | `restored`, `reason: changecount-changed \| text-changed \| nothing-saved`, `delayMs`, `elapsedMs`, `trigger` |
| `reset-rule-triggered`, `session-reset`, `reset-skipped` | reset rule | `rule` / `reason: max-duration \| lock-screen \| suspend`, `heldMs` |
| `power-event` | powerMonitor | `event` |
| `copy-clicked` | overlay "Kopírovať" | `copied`, `changeCount` |
| `settings-changed`, `simulate`, `overlay-test`, `permission-requested`, `settings-pane-opened` | control window actions | |

Evaluate a run: `pnpm log:summary <runId> key-down key-up session-start session-reset focus-check paste-result clipboard-restore`.

## Interactive test protocol

Preparation: before every paste test, copy a marker to the clipboard (for example select and copy `CLIP-BEFORE-<test id>` in TextEdit) so you can check the restore with Cmd+V afterwards. Never press Enter in Slack or Terminal during the tests. Defaults unless stated: candidate Swift, key Right Option, transcription 1000 ms, restore delay 500 ms, maximum 120000 ms, compare window id on, transient on, skipTransformProcessType on. Write down the run id from the control window for each block.

### T0 - Launch and permissions

| ID | Steps (human) | Expected log lines | Pass criteria |
|---|---|---|---|
| T0.1 | `pnpm start` (hotkeys on, candidate Swift). Note any system prompt: exact title, text, buttons. Take a screenshot. Do not answer it yet if you want to record it, then click "Open System Settings". | `app-start`, `hotkeys-enabled {enabled:true}`, `hotkey-source {source:swift, running:false, error:tap-create-failed}`, `helper-event {event:tap-error, listenAccess:false}` | Prompt text recorded (or "no prompt" recorded); "Electron" listed in Input Monitoring |
| T0.2 | Enable Electron in Input Monitoring. In the control window click "Restart helper". If the Swift source is still not running, `pnpm stop` + `pnpm start` and record that a relaunch was needed. | `permissions {helper.listenEvent:true}`, `helper-restarted`, `hotkey-source {source:swift, running:true}` | Swift source shows "running"; record whether restart of the helper was enough |
| T0.3 | Switch candidate to "uiohook-napi". Record the prompt. Enable Electron in Accessibility, then switch candidate to Swift and back to uiohook (or relaunch). | `hotkey-source {source:uiohook, running:false, error:...}` then `{running:true}` after the grant; `permissions {helper.accessibility:true, helper.postEvent:true, electronAccessibility:true}` | Prompt text recorded; uiohook source running after the grant; record whether a relaunch was needed |
| T0.4 | (optional) Quit, run `pnpm start:direct` from Terminal.app, look at which app the prompts and the TCC entries name. | `app-start`, `hotkey-source` as in T0.1 | Prompts and the new TCC entries name Terminal, not Electron (responsible app is the launching terminal) |

### T1 - Hotkey down/up (Task 1 Step 1)

| ID | Steps (human) | Expected log lines | Pass criteria |
|---|---|---|---|
| T1.1 | Swift, Right Option. Focus TextEdit. Hold Right Option about 2 s, release. Repeat 10 times. | Per press: `key-down {source:swift, keycode:61, active:true}`, `session-start`, `target-captured {target.bundleId:com.apple.TextEdit}`, `key-up {keycode:61}`, `session-release` | 10/10 down/up pairs, no `down-ignored` / `up-ignored`, overlay appears on each press |
| T1.2 | Key Right Option: press and release Left Option 5 times. Then hold Right Option, tap Left Option twice, release Right Option. Then set key Left Option and press Left Option 5 times. | First part: no `key-down`. Second: exactly one down/up pair for 61. Third: pairs with `keycode:58` | Left and right Option are distinguished |
| T1.3 | Key Fn. System Settings > Keyboard > "Press 🌐 key to" = "Do Nothing": press Fn 5 times. Then "Show Emoji & Symbols", then "Start Dictation" (and the dictation shortcut "Press 🌐 twice" if offered): press and hold Fn each time. | `key-down/up {keycode:63}` per press | Record per setting: events arrive (yes/no), system action fires (emoji picker / dictation opens) |
| T1.4 | Candidate uiohook, key Right Option: repeat T1.1. Then key Fn. | Pairs with `source:uiohook`; for Fn `hotkey-source {error:uiohook-has-no-keycode-for-fn}` | 10/10 for Right Option; Fn unsupported confirmed |
| T1.5 | Candidate Swift, "Also log the other candidate" on, Right Option: press 20 times, some short taps (<150 ms), some long holds. | Each press logs `key-down` from `swift` (`active:true`) and `uiohook` (`active:false`) | Count missing events per candidate; compare `eventTs` |
| T1.6 | Swift: tap Right Option very quickly 10 times in a row. | Every `key-down` followed by `key-up`; sessions go through `paste-result` or `down-ignored` while busy | No session stuck in `recording` (control window shows `idle` again after about 3 s) |
| T1.7 | Run T1.1 once with the swift helper alone in Terminal: `pnpm helper:listen` (Terminal needs its own Input Monitoring grant for this). | stdout JSON lines `{"event":"down","keycode":61,...}` | Standalone helper works outside Electron (optional) |

### T2 - Overlay (Task 1 Step 2)

The "Overlay test (in 3 s, 5 s)" button shows the overlay 3 s after the click for 5 s without a session, so you can switch to the target app and keep typing. A real hotkey press works too.

| ID | Steps (human) | Expected log lines | Pass criteria |
|---|---|---|---|
| T2.1 | Slack: click "Overlay test", switch to Slack within 3 s, click into the message box and keep typing while the overlay is visible. | `overlay-test {phase:scheduled}`, `overlay-shown {visible:true, focused:false}`, `overlay-focus-check {context:overlay-test, actualApp:com.tinyspeck.slackmacgap, focusKept:true, overlayFocused:false}`, no `app-activation {active:true}` after `overlay-shown` | Overlay visible at bottom-center; every typed character lands in Slack |
| T2.2 | Same as T2.1 in VS Code (editor). | same, `actualApp:com.microsoft.VSCode` | same |
| T2.3 | Same as T2.1 in Terminal. | same, `actualApp:com.apple.Terminal` | same |
| T2.4 | Safari: play a video and enter video fullscreen; then repeat with the Safari window in fullscreen (Ctrl+Cmd+F). Hold Right Option 3 s in each. | `overlay-shown`, `overlay-focus-check {actualApp:com.apple.Safari, focusKept:true}` | Overlay visible over the fullscreen video, Safari stays fullscreen and frontmost. If not visible: uncheck "skipTransformProcessType" (`overlay-recreated`), retry, and note whether the Dock icon and the app menu disappear |
| T2.5 | Mission Control: create a second Space, open a TextEdit window there, switch to it, hold Right Option 3 s. | `overlay-shown`, `overlay-focus-check {focusKept:true}` | Overlay appears on the second Space; macOS does not switch back to the Space of the control window |
| T2.6 | (if a second display is attached) Move the cursor to the other display, hold Right Option. | `overlay-shown` with a different `displayId` | Overlay at bottom-center of the display under the cursor |
| T2.7 | Produce a "focus changed" result (T4.5), then click "Kopírovať" in the overlay. Cmd+V in TextEdit. | `copy-clicked {copied:true}`, `overlay-focus-check {context:copy-click}`; check whether `app-activation {active:true}` appears | Click works on the non-focusable panel; text in clipboard; record whether the click activated Electron |

### T3 - Lost key-up (Task 1 Step 3)

| ID | Steps (human) | Expected log lines | Pass criteria |
|---|---|---|---|
| T3.1 | Swift. Hold Right Option, press Cmd+Tab with the left hand and switch to another app, release Cmd, then release Right Option. Then press Right Option again. Repeat 5 times. | `key-down`, then either `key-up` (up delivered) or no `key-up`; next press: `session-start` with a new `sessionId` (or `down-ignored` followed by `key-up` if the up was lost and no reset happened) | Record if `up` arrives. After each case the next press starts a new session (at the latest after the max-duration reset) |
| T3.2 | Hold Right Option, lock with Ctrl+Cmd+Q, release Right Option on the lock screen, wait 5 s, unlock, press Right Option. | `power-event {lock-screen}`, `reset-rule-triggered {rule:lock-screen}`, `session-reset {reason:lock-screen}`, possibly `up-ignored`, `power-event {unlock-screen}`, then `session-start` | Session ended on lock; next press after unlock starts a new session; no paste on the lock screen |
| T3.3 | Hold Right Option, close the lid (or Apple menu > Sleep), release while asleep, wait 15 s, wake and unlock, press Right Option. | `power-event {suspend}`, `session-reset {reason:suspend}`, `power-event {resume}`, then `session-start` | Same as T3.2; also check for `helper-event {event:tap-reenabled}` and whether the Swift source still delivers events after wake |
| T3.4 | Set "Push-to-talk maximum" to 10000. Hold Right Option 13 s, release, press again. | `reset-rule-triggered {rule:max-duration, maxMs:10000}` about 10 s after `session-start`, `session-reset`, `up-ignored`, then `session-start` | Reset at 10 s +- 0.1 s; next press works. Set the maximum back to 120000 |
| T3.5 | Candidate uiohook: repeat T3.1-T3.3. | as above with `source:uiohook` | Same pass criteria; record differences (for example the hook dying after sleep) |

### T4 - Paste with focus check and clipboard restore (Task 1 Step 4)

Accessibility must be granted (T0.3). Before each test, copy the marker `CLIP-BEFORE-<id>`.

| ID | Steps (human) | Expected log lines | Pass criteria |
|---|---|---|---|
| T4.1 | Slack message box (do not send): hold Right Option 2 s, release, wait 2 s, then Cmd+V once in the same box. | `focus-check {result:same}`, `secure-input-check {enabled:false}`, `clipboard-saved`, `clipboard-written`, `paste-result {kind:pasted, postAccess:true}`, `clipboard-restore {restored:true}` | `Codevo test N: ahoj, toto je skúška prepisu ľščťžýáíé.` inserted with diacritics; the extra Cmd+V inserts `CLIP-BEFORE-T4.1` |
| T4.2 | Same in the VS Code editor. | same | same |
| T4.3 | Same at a Terminal zsh prompt (do not press Enter). | same | same |
| T4.4 | Restore delay sweep: for 50, 100, 200, 300, 500 ms, run T4.1-T4.3 once each. | `clipboard-restore {delayMs:<d>, restored:true}` | For each app and delay, record whether the dictated text (correct) or the marker (delay too short) was inserted. The smallest delay that is correct in all three apps is the result |
| T4.5 | Set transcription to 3000 ms. In TextEdit, hold and release Right Option, then within 3 s Cmd+Tab to Notes and click into a note. | `focus-check {result:app-changed}`, `paste-result {kind:focus-changed, pasted:false}`, no `clipboard-saved` for that session | Nothing pasted in TextEdit or Notes; overlay shows the warning and "Kopírovať"; clipboard still holds the marker |
| T4.6 | Two TextEdit windows. Hold and release Right Option in window 1, switch to window 2 with Cmd+` within 3 s. Repeat with "compare window id" off. | On: `focus-check {result:window-changed}`, no paste. Off: `focus-check {result:same}`, paste into window 2 | Record which behaviour the product should have. Set transcription back to 1000 ms |
| T4.7 | Safari, any login page, click into the password field. Hold and release Right Option. Repeat in Terminal with "Secure Keyboard Entry" on (Terminal menu) or at a `sudo` password prompt. | `secure-input-check {enabled:true, pid}`, `secure-input-detected {fallback:clipboard}`, `paste-result {kind:secure-input, pasted:false}`, no `clipboard-restore` | Nothing typed into the field; Cmd+V afterwards in TextEdit gives the dictated text. Also record whether `key-down`/`key-up` arrive at all while secure input is on, per candidate |
| T4.8 | Set restore delay to 5000. Paste into TextEdit, then within 5 s select some other text and Cmd+C. | `clipboard-restore {restored:false, reason:changecount-changed}` | Your new copy stays in the clipboard. Set the delay back |
| T4.9 | Copy an image (Cmd+Ctrl+Shift+4 to clipboard) or rich text from Safari, then run T4.1 in TextEdit. Afterwards Cmd+V in Preview (File > New from Clipboard) or a rich TextEdit document. | `clipboard-saved {types:[public.png, ...]}`, `clipboard-restore {restored:true}` | The original image or rich text comes back unchanged |
| T4.10 | (optional, if a clipboard manager is installed) Run T4.1 with "Mark clipboard write transient" on and off. | `clipboard-written {transient:true\|false}` | Record whether the dictated text shows up in the clipboard manager history |

## Results

(empty, filled in after the interactive session)

## Decision

(empty, filled in from the results: helper technology, overlay options, paste method and restore delay, permission list)
