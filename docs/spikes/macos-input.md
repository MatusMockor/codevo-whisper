# Spike: macOS hotkey -> overlay -> paste

Phase 0, Task 1 (`docs/plans/2026-10-25-phase-0-spikes.md`). Spec sections 5.1-5.3.

Status: built and self-tested without a human. The interactive protocol below (key holding, lock, sleep, focus, fullscreen, Spaces, password field) is still open. The "Results" section is filled in after the interactive session.

## What was built

`spikes/macos-input/` is a standalone Electron 45.0.0 app (TypeScript 7.0.2, Node 24, pnpm 10.34.5) plus a Swift 6.4 helper.

| Part | Files | What it does |
|---|---|---|
| Swift helper | `helper/Sources/*.swift`, `helper/build.sh` -> `helper/build/codevo-input-helper` | One binary, three modes. `serve` (used by the app): JSON-lines RPC over stdin/stdout plus key events. `listen [keycodes]`: standalone listen-only `CGEventTap` that prints `{"event":"down"\|"up","keycode":n,"ts":ms,"flags":n}`. `cmd <name>`: one-shot command for manual checks. |
| Helper commands | `Commands.swift` | `ping`, `permissions` (`CGPreflightListenEventAccess`, `CGPreflightPostEventAccess`, `AXIsProcessTrusted`), `request-permission`, `frontmost` (`NSWorkspace.frontmostApplication` plus the top layer-0 window id of that app), `secure-input` (`IsSecureEventInputEnabled` plus `kCGSSessionSecureInputPID` from `IOConsoleUsers`), `clipboard-save` / `clipboard-write` / `clipboard-restore` (full-fidelity `NSPasteboard` save of every item and type, restore only if `changeCount` and text are unchanged), `paste` (CGEvent sequence Command down, V down, V up, Command up to `.cghidEventTap`), `focused-element` (see below), `modifier-flags` (`CGEventSource.flagsState` for `.hidSystemState` and `.combinedSessionState`), `selftest-focus-desktop` (self-test fixture only: activates Finder and sets `AXMain` on the desktop `AXScrollArea`, the same as clicking the desktop), `listen-start` / `listen-stop`. |
| Focused element | `FocusedElement.swift`, `FocusLookup.swift`, `Editability.swift`, `ChromiumApp.swift`, `FinderDesktop.swift`, `AXQuery.swift` | `AXFocusedUIElement` of `AXUIElementCreateSystemWide()`, with the frontmost app's `AXFocusedUIElement` as fallback. Messaging timeout 150 ms per element. Returns `editable`, `role`, `subrole`, `reason`, plus `lookup` (which source answered, AX error per source), `engine` (`native`, `electron`, `chromium`, from `Contents/Frameworks`), `elementPid`, `elapsedMs`, `manualAccessibility`. `editable:true`: role or subrole `AXTextField` / `AXTextArea` / `AXComboBox` / `AXSearchField` (`text-role`), or a settable string `AXValue` (`settable-string-value`), or a string `AXValue` plus `AXSelectedTextRange` on a non-`AXStaticText` element (`selected-text-range`), or `AXEditable` / `AXIsEditable` true (`ax-editable`). `editable:false`: a focused element exists and none of that holds (`not-editable`), or there is no focused element, Finder is frontmost and its focused window is missing or is the desktop (`finder-desktop`). `editable:null`: no Accessibility (`no-accessibility`), both lookups timed out (`ax-timeout`), no focused element (`no-focused-element`), or a Chromium/Electron app whose focused element is only `AXWindow` / `AXApplication` (`chromium-no-tree`). For Chromium/Electron apps that do not answer `true`, `AXManualAccessibility=true` is set on the app element once per pid, then the lookup is retried after 80, 150, 250, 350 ms while the answer is `null`; `manualAccessibility {attempted, setResult, before, helped}` records it. |
| Key detection | `KeyTap.swift`, `Shortcut.swift` | Listen-only session tap on `flagsChanged` and `keyDown`. A `keyDown` with keycode 9 (physical V position), Control and Command set, Shift and Option not set and no autorepeat is emitted as `{"event":"shortcut","name":"paste-last"}`. Down/up comes from the device-specific flag bit: left Option 58 -> `0x20`, right Option 61 -> `0x40`, Fn 63 -> `0x800000`. No dedupe, so a lost up is corrected by the next press. Re-enables the tap on `tapDisabledByTimeout` / `tapDisabledByUserInput` and logs `tap-reenabled`. |
| Hotkey candidates | `src/main/hotkey/` | Strategy `HotkeySource` with `SwiftTapSource` (helper) and `UiohookSource` (`uiohook-napi` 1.5.5 in main). `HotkeyRouter` sends only the active candidate to the session. With "Also log the other candidate" on, both run and the other one is logged with `active:false` so the two can be compared. |
| Session | `src/main/session/DictationSession.ts` | `idle -> recording -> transcribing -> inserting -> result -> idle`. Key-down captures the frontmost app and shows the overlay. Key-up waits the simulated transcription time (default 1000 ms), then runs the paste flow. |
| Reset rule | `src/main/session/ResetGuard.ts` | A session ends after the push-to-talk maximum (default 120000 ms, configurable) or on `powerMonitor` `lock-screen` / `suspend`. `unlock-screen`, `resume`, `shutdown` and `user-did-*` are logged too. After a reset a late key-up is ignored and the next key-down starts a new session. |
| Paste flow | `src/main/paste/` | Focus check (pid, plus window id if "compare window id" is on) -> `IsSecureEventInputEnabled` (if on: clipboard fallback, no paste, no restore) -> `focused-element` (if `editable:false`: write the transcript to the clipboard, no Cmd+V, no restore, overlay "Skopírované - vlož cez ⌘V"; if `true` or `null`: continue) -> save clipboard -> write text (optionally marked `org.nspasteboard.TransientType`) -> Cmd+V -> restore after the configurable delay, only if unchanged. A pending restore is flushed before the next paste so a quick second dictation never saves the inserted text as the user's clipboard. |
| Paste last transcript | `src/main/paste/LastTranscript.ts`, `PasteLastAction.ts`, `ModifierGate.ts`, `src/main/hotkey/ShortcutListener.ts` | The last session transcript is kept in memory (set after the simulated transcription, before the paste). "Vložiť posledný prepis" runs the same paste flow (focus, secure input, focused element) with the current frontmost app as target. Trigger Ctrl+Cmd+V (Swift tap only, so only while the hotkeys are on): waits up to 1000 ms until Control and Command are physically released (`hidSystemState`), then pastes. Trigger control window button: waits 3 s so you can switch to the target app. Ignored while a session is recording, transcribing or inserting. The overlay shows the result for 2.2 s. The focused element is also probed at key-down (`focused-element {phase:key-down}`) so a Chromium/Electron tree is enabled before the paste. |
| Overlay | `src/main/windows/OverlayWindow.ts`, `src/renderer/overlay.*` | `BrowserWindow` with `type:'panel'`, `focusable:false`, `frame:false`, `transparent:true`, `hasShadow:false`, `skipTaskbar`, `hiddenInMissionControl`, `setAlwaysOnTop(true,'screen-saver')`, `setVisibleOnAllWorkspaces(true,{visibleOnFullScreen:true, skipTransformProcessType})`, shown with `showInactive()` at bottom-center of the work area of the display under the cursor (560x132, 28 px margin). Shows key state, candidate, session state, elapsed time, a fake streaming Slovak transcript, the outcome, and a "Kopírovať" button when nothing was pasted. |
| Self-reporting | `src/main/session/OverlayFocusAudit.ts` | 300 ms after every overlay show (and after a "Kopírovať" click) it logs `overlay-focus-check` with the expected and actual frontmost app, `overlayVisible` and `overlayFocused`. `app-activation` is logged whenever Electron becomes or stops being the active app, so a stolen focus shows up in the log. |
| Control window | `src/renderer/control.*` | Permission status, source status, last transcript, all settings, buttons (request permission, open System Settings pane, delayed overlay test, simulated press, "Vložiť posledný prepis (o 3 s, ⌃⌘V)", restart helper, reveal log), a paste-target textarea and a live log tail. |
| Self-test | `src/main/selftest/` | `pnpm selftest`: automated checks that need no key presses (see "Verified without a human"). The focused-element and no-text-field checks need Accessibility for Electron. |

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

### Focused element and paste last transcript (2026-10-25, macOS 26.6.2, Accessibility and Input Monitoring granted to Electron)

| Check | Evidence |
|---|---|
| Helper still builds in Swift 6 mode with no warnings | `helper/build.sh` |
| `pnpm typecheck` passes | |
| `pnpm selftest` passes 29/29 (two info checks), run `fcbc9cf9` | see below |
| Real Ctrl+Cmd+V through the Swift tap of the running app (synthetic `CGEvent` sequence Control down, Command down, V down/up, Command up, Control up from the agent shell, Finder desktop focused, no transcript in memory yet): `shortcut {keycode:9, latencyMs:0}`, `paste-last-requested`, `paste-last-modifiers {released:true, waitedMs:73}`, `paste-last-result {kind:no-transcript}`, overlay shown, no clipboard write | run `0de1d27b` |

New self-test checks: `no-command-stuck-after-synthetic-paste` (Command not held in `hidSystemState` after the earlier same-focus paste); `focused-element-finder-desktop-not-editable` (Finder frontmost, desktop focused via the fixture: `editable:false`, role `AXGroup`, `reason:not-editable`); `focused-element-control-textarea-editable` (control window textarea focused: `editable:true`, role `AXTextArea`, `reason:text-role`); `no-text-field-session-copies`, `no-text-field-no-save-no-restore`, `no-text-field-clipboard-keeps-transcript` (simulated session into the Finder desktop: `paste-result {kind:copied-no-text-field, role:AXGroup}`, no `clipboard-saved` / `clipboard-restore` for that session, `changeCount` unchanged 1.2 s later); `paste-last-modifier-gate-sees-no-held-keys` and `paste-last-uses-same-checks` (paste-last into the Finder desktop: `copied-no-text-field` with the last session id); `user-clipboard-restored-after-no-text-field`. The no-text-field checks run between a helper `clipboard-save` and a forced `clipboard-restore`, so the user's clipboard (a `public.png` during the run) is put back byte-identical.

Not verifiable without a human or without permissions: real key events from either candidate, the actual permission prompts, the paste landing in an app, behaviour over fullscreen apps and Spaces, real lock / sleep, secure input in a real password field. Screen capture from the agent shell also failed (no Screen Recording grant), so nothing visual has been checked yet.

## Findings so far (static, from source)

- `uiohook-napi` 1.5.5 (libuiohook) cannot report Fn: `kVK_Function` (63) maps to `VC_UNDEFINED` and the modifier handler has no Fn branch. With key "Fn" the uiohook source reports `uiohook-has-no-keycode-for-fn`.
- libuiohook tracks Option with the generic `kCGEventFlagMaskAlternate`, so with both Options held, releasing one is not reported as up. The Swift helper uses the device-specific bits and has no such issue.
- libuiohook installs an active (`kCGEventTapOptionDefault`) session tap and requires Accessibility, which is broader than the Input Monitoring a listen-only tap needs. The Swift helper uses `.listenOnly`.
- A listen-only tap cannot swallow events, so Fn bound to the emoji picker or to dictation will still trigger that system action. Suppressing it would need an active tap (Accessibility) and may not work for the Globe key at all (T1.3).

## Findings: focused element, paste last transcript (2026-10-25)

- Bug fixed in `Paste.swift`: posting V down/up with `flags = .maskCommand` to `.cghidEventTap` (the old implementation) leaves left Command (keycode 55) logically held in `hidSystemState` and `combinedSessionState` until the user physically presses Command. Reproduced with a harmless Cmd+F19 from the agent shell: `CGEventSource.keyState(.hidSystemState, 55)` stayed `true` (flags `0x20100000`) for minutes. Every paste of the earlier spike runs could leave Command stuck, so the next real keystroke can arrive as Cmd+key. Paste now posts Command down, V down, V up, Command up (flags cleared on the last event); the stuck state does not occur any more (`no-command-stuck-after-synthetic-paste`). Check the earlier T4 results with this in mind.
- System-wide `AXFocusedUIElement` answered (`systemError:success`) in the helper spawned by Electron, but returned `kAXErrorCannotComplete` every time the helper ran as a one-shot command from the agent shell (a T3 Code child). The app-element fallback answered in both cases, so keep it.
- Finder: file list window `AXList` (`editable:false`), desktop `AXGroup` inside the desktop `AXScrollArea` (`editable:false`). The "no focused element + Finder" branch (`finder-desktop`) was not hit on this Mac, because Finder always reported a focused element.
- Chromium/Electron expose no tree until something asks for it: the focused element is the `AXWindow` itself or missing. Setting `AXManualAccessibility=true` returns `success` (reading it back still gives `false`), and Electron then takes roughly 0.9-1.5 s to build the tree. The first lookup per pid therefore usually ends `editable:null, manualAccessibility.helped:false` after about 880 ms of retries, and every later lookup answers in 2-8 ms (`AXTextArea`). With the key-down warm-up, the tree is normally ready by the time the paste runs. `AXEnhancedUserInterface` is not implemented by Discord (`-25208`). Chromium seems to drop the tree a few seconds after the client that asked for it disconnects (seen with one-shot helper processes), so the long-running helper is required.
- The retries block the helper main thread (and so the key tap event delivery) for up to about 0.9 s, once per Chromium pid. Acceptable for the spike. The product should run AX queries off the tap's run loop.
- The `AXValue`-settable and `AXSelectedTextRange` rules alone give false positives in Chromium: a focused video `AXSlider` in Chrome has a settable numeric `AXValue` and exposes `AXSelectedTextRange {0,0}`. Both rules now require a string `AXValue` (and `AXSelectedTextRange` also requires a role other than `AXStaticText`). With that the Chrome slider is `editable:false`.
- Ctrl+Cmd+V via the listen-only tap: the event is not swallowed, so the frontmost app also receives Ctrl+Cmd+V (in most apps nothing is bound to it, some beep). Swallowing it would need an active tap (Accessibility) or a `RegisterEventHotKey` / Electron `globalShortcut` registration. Keycode 9 is the physical V position, so on QWERTZ/Slovak layouts it is still V, but on Dvorak it is a different letter. The modifier gate waits for the physical release (`hidSystemState`) before Cmd+V is posted, so Control is not still held during the paste (`paste-last-modifiers {waitedMs}`).
- Editable values observed from the agent shell (focus as the owner left it, apps not clicked): Finder file list `false` (`AXList`), Finder desktop `false` (`AXGroup`), spike control textarea `true` (`AXTextArea`), T3 Code composer `true` (`AXTextArea`, Electron), Discord message box `null` on the first lookup, then `true` (`AXTextArea`, Electron), Messages `true` (`AXTextArea` / `AXTextField`), Chrome with a focused video slider `false` after the rule fix (was `true` before). VS Code, Slack and Terminal were not running, and Chrome had no textarea focused, so those values are for T4.10.

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
| `clipboard-saved`, `clipboard-written` | paste flow | `items`, `types`, `changeCount`, `transient`, `restore:false` (copied-no-text-field), `text` |
| `paste-result` | outcome | `kind: pasted \| focus-changed \| secure-input \| copied-no-text-field \| error`, `origin: session \| paste-last`, `posted`, `postAccess`, `ax {editable, role, subrole, reason}` (pasted), `role`, `subrole`, `reason` (copied-no-text-field) |
| `focused-element` | key-down warm-up and before paste | `phase: key-down \| paste`, `origin`, `editable`, `role`, `subrole`, `reason`, `engine`, `lookup.source`, `lookup.systemError`, `lookup.appError`, `manualAccessibility`, `elapsedMs` |
| `shortcut` | Ctrl+Cmd+V seen by the Swift tap | `name: paste-last`, `keycode`, `flags`, `eventTs`, `latencyMs`, `targetAlsoReceives:true` |
| `paste-last-requested`, `paste-last-ignored`, `paste-last-modifiers`, `paste-last-result` | paste last transcript | `trigger: shortcut \| button`, `sessionId`, `reason: already-running \| session-busy`, `released`, `waitedMs`, `hidFlags`, `combinedFlags`, `kind` (`no-transcript` or a paste-result kind) |
| `selftest-focused-element`, `selftest-clipboard-guard` | self-test only | `context: finder-desktop \| control-textarea`, fixture result, focused element |
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
| T4.8 | Finder: click an empty spot on the desktop (no file selected), press and release the hotkey. Repeat with a Finder window file list focused. Then Cmd+V in TextEdit. | `focused-element {phase:paste, editable:false, role:AXGroup (desktop) \| AXList / AXOutline (window)}`, `clipboard-written {restore:false}`, `paste-result {kind:copied-no-text-field, role, subrole}`, no `clipboard-saved` and no `clipboard-restore` for that session | Overlay shows "Skopírované - vlož cez ⌘V"; nothing happens in Finder; Cmd+V in TextEdit inserts the dictated text (the clipboard keeps the transcript, the marker is gone). Record the role per case |
| T4.9 | Dictate once into TextEdit (T4.1). Open Notes, click into a note, press Ctrl+Cmd+V. Then click "Vložiť posledný prepis (o 3 s, ⌃⌘V)" in the control window and click into the note within 3 s. Then Ctrl+Cmd+V with the Finder desktop focused. | `shortcut {name:paste-last}`, `paste-last-requested {trigger:shortcut}`, `paste-last-modifiers {released:true, waitedMs}`, `focused-element {origin:paste-last, editable:true}`, `paste-result {origin:paste-last, kind:pasted}`, `clipboard-restore {restored:true}`, `paste-last-result {kind:pasted}`; button: same with `trigger:button`; desktop: `paste-last-result {kind:copied-no-text-field}` | The same `Codevo test N` text lands in the note twice; the marker is back in the clipboard after the pastes; record what Notes itself does with Ctrl+Cmd+V (the listen-only tap does not swallow it) and whether Control or Command acts stuck afterwards |
| T4.10 | Dictate into VS Code (editor), Slack (message box, do not send), Terminal (zsh prompt, do not press Enter) and a Chrome page textarea (for example `data:text/html,<textarea autofocus></textarea>`). Do each app twice in a row. | Per app: `focused-element {phase:key-down}` and `{phase:paste}` with `editable`, `role`, `engine`, `manualAccessibility {setResult, helped}`, `elapsedMs`; `paste-result {kind:pasted, ax}` | Text lands in all four. Record per app and attempt: `editable` (true/null), role, `engine`, whether `manualAccessibility.helped`, and `elapsedMs` of the first lookup. Expected: `null` or `true` on the first attempt in Electron/Chromium apps, `true` afterwards; never `false` in a real text field |
| T4.11 | Set restore delay to 5000. Paste into TextEdit, then within 5 s select some other text and Cmd+C. | `clipboard-restore {restored:false, reason:changecount-changed}` | Your new copy stays in the clipboard. Set the delay back |
| T4.12 | Copy an image (Cmd+Ctrl+Shift+4 to clipboard) or rich text from Safari, then run T4.1 in TextEdit. Afterwards Cmd+V in Preview (File > New from Clipboard) or a rich TextEdit document. | `clipboard-saved {types:[public.png, ...]}`, `clipboard-restore {restored:true}` | The original image or rich text comes back unchanged |
| T4.13 | (optional, if a clipboard manager is installed) Run T4.1 with "Mark clipboard write transient" on and off. | `clipboard-written {transient:true\|false}` | Record whether the dictated text shows up in the clipboard manager history |

## Results

Interactive session with the owner, 2026-10-25, macOS 26.6.2, Apple Silicon, external third-party keyboard without a right Option key.

| Test | Result | Evidence |
|---|---|---|
| T0 permissions | Pass with friction | `CGRequestListenEventAccess` prompted once, but Electron did not appear in the Input Monitoring list; the owner had to add `Electron.app` manually (it lives in a hidden `node_modules/.pnpm` path). After "Quit & Reopen" macOS relaunched bare Electron without the app path. A relaunch of the spike was needed before `listenEvent` became true. Accessibility was granted from the prompt without issues. |
| T1 Fn | Fail on this keyboard | No `flagsChanged` event for keycode 63 at all: the Fn key of the third-party keyboard is handled in its firmware and is invisible to macOS. |
| T1 right Control | Pass | Down/up delivered by the Swift helper, key latency 0-1 ms, `heldMs` matches. |
| T2 overlay | Pass (owner report) | Overlay shown with `showInactive` on display 2, focus kept by the frontmost app; owner confirmed visibility over fullscreen video and on another Space. |
| T3 lost key-up / lock | Pass (owner report) | Owner confirmed the hotkey works normally after lock and unlock. The reset events were not visible in this run's log, so the self-test (simulated lock-screen and suspend) remains the main evidence. |
| T4 paste into other app | Pass | T3 Code composer (`AXTextArea`, editable true) received the text; clipboard restored after 500 ms. |
| T4 focus change during transcription | Pass | Cmd+Tab after release: nothing pasted. |
| T4 password field | Pass | Secure input detected, nothing pasted. |
| T4 no text field (Finder) | Fail before fix, pass after | Before: Cmd+V went into Finder and was logged as pasted. After the focused-element check: `copied-no-text-field` (`AXGroup`), transcript left on the clipboard, overlay "Skopírované - vlož cez ⌘V". |
| T4 paste last transcript (Ctrl+Cmd+V) | Pass | Owner confirmed. |
| Stuck Command key | Bug found and fixed | The first paste implementation posted V with the Command flag but no Command key events, which could leave Command logically held. Fixed by posting Command down, V down, V up, Command up; a self-test check guards it. |
| VS Code, Slack, Terminal, Chrome textarea | Not run | Apps were not open; verify with the real app in phase 3. |

## Decision

- **Hotkey helper:** Swift helper with a listen-only `CGEventTap` (needs Input Monitoring only). `uiohook-napi` is rejected: no Fn, cannot distinguish left/right Option release, needs Accessibility.
- **Hotkey choice:** user-configurable through a key recorder; first run asks the user to press their key. Fn/Globe cannot be assumed on third-party keyboards. Supported modifier keys in v1: Fn (63), left/right Option (58/61), right Command (54), right Control (62).
- **Overlay:** non-activating panel (`type: 'panel'`, `focusable: false`, `alwaysOnTop` level `screen-saver`, `visibleOnAllWorkspaces` with `visibleOnFullScreen`, `showInactive`). Default display mode is the indicator only; live text is an opt-in setting (spec 5.3).
- **Insertion:** insertion target captured at key-down; at insertion time check same frontmost app, secure input, and the AX focused element. Editable true or unknown: paste via clipboard + Command down, V down, V up, Command up, restore the clipboard after 500 ms only if unchanged. Editable false: copy only, keep the transcript on the clipboard, show "Skopírované - vlož cez ⌘V".
- **Paste last transcript:** Ctrl+Cmd+V and a menu bar item, same checks.
- **Chromium/Electron targets:** set `AXManualAccessibility` once per process; the first AX query can take about 1 s, so run the check at key-down as well.
- **Permissions:** Input Monitoring (hotkey) and Accessibility (paste, focused element). The real app is signed with a stable bundle id, so the "add manually from a hidden folder" friction of the spike does not apply; first-run screens still deep-link to both panes and verify the grant, prompting a relaunch when Input Monitoring needs it.
