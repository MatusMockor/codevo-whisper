# Dictation languages: design and implementation plan

Date: 2026-11-09. Status: proposal, nothing implemented. Inputs: `docs/research/stt-models.md`, the pinned transcribe.cpp source (`8facde6fcd8fb9caa585a5788ab450df6e8ec7db`), the code on `main` at `0eb49b9`, a read-only look at the home server, and a new benchmark run for this plan (section 3).

## 1. Problem and goal

The owner dictates in Slovak and sometimes gets Czech spelling or Ukrainian (Cyrillic) text. The default model, Parakeet Ultra, runs both locally and on the server (the `stt` container runs `parakeet-ultra-F16.gguf`, Vulkan). It has no language conditioning, so the current Settings row "Jazyk" (`settings.language`, sk/cs/en/auto, default `sk`) does nothing with it. The owner uses the server only (`engineOrder: ["server"]`, `localModelId: null`, `language: "sk"`). The server path is what has to work first.

What the owner wants:

- The default stays automatic recognition.
- In Settings he can pick one or more languages to recognise.
- The choice is made on the Mac and has to work when transcription runs on the paired server.

## 2. Decision

**Restricted mode = language ID (VoxLingua107, restricted to the chosen languages) routes each segment to Canary 1B v2 with the detected language, but only when the ID is confident. Uncertain or out-of-set audio goes to Parakeet verbatim. A translation guard compares Canary with Parakeet and keeps Parakeet's text when they disagree. Routing runs inside the STT process (the server sidecar, or the desktop local engine). The gateway and the protocol only carry the ordered language list.**

Per mode:

| Mode | Segment flow | Models used |
|---|---|---|
| Automaticky (default) | Unchanged: the active model with no hint (Parakeet). | Parakeet |
| One language L | LID over the 25 supported languages. If another language wins with p >= 0.99, keep Parakeet verbatim. Otherwise run Canary(L) and Parakeet in parallel. Use Canary unless the guard rejects it. | LID + Canary + Parakeet |
| Several languages A = [a1, a2, ...] | LID restricted to A. If p(top) >= 0.99, run Canary(top) and Parakeet in parallel, then the guard. If p(top) < 0.99, keep Parakeet verbatim, unless its text uses a script or letters that no language in A uses: then use Canary(top). A foreign-language check runs first, as in one-language mode. | LID + Canary + Parakeet |

Guard: fold both texts (NFC, lowercase, strip combining marks and punctuation), compute character similarity `1 - levenshtein / max(len)`. If similarity < 0.5 and Parakeet's text is orthographically consistent with A, keep Parakeet. Otherwise keep Canary.

Why this design:

1. **It never translates on the measured data.** With the 0.99 gate, Canary got a wrong language 0 times in 540 clips of 1.5 s or longer (sk/cs/en, allowed sets of 2 and 3 languages). Without the gate, 4-9 of 180 at 2 s would have been translated.
2. **It is never worse than today for speech in the chosen languages.** Full FLEURS clips, WER: sk 6.6-6.8 % vs Parakeet 7.5 %, cs 7.4 % (cs only) or 11.3 % (sk+cs) vs 12.3 %, en 5.9 % vs 5.6 %.
3. **It forces the language exactly where Parakeet has no control.** Parakeet cannot be conditioned, and transcribe.cpp has no logit or script bias for it. Only a language-conditioned model can guarantee "Slovak in, Slovak out". Among the shipped models that is Canary (best sk/cs accuracy, 25 languages, 0.14 s warm).
4. **One implementation serves both paths.** The routing lives in a shared package used by `apps/stt` (server) and the desktop local engine, so behaviour is the same on the Mac and on the server.
5. **No engine upgrade.** The pinned transcribe.cpp already has the LANGID role (`include/transcribe/langid.h`, `transcribe_langid_run` with an `allowed` list and `allowed_mass`), and the CLI supports `--allow`. Canary takes `run_params.language`.

**Deviation from the brief, based on the evidence:** "prefer the first chosen language when LID is unsure" is used only as the tie-break and for the order in the UI. It is not used to send unsure audio to Canary(primary). The unsure cases are mostly the *other* language: at 2 s with [sk, cs, en], 39 of 55 unsure clips were not Slovak. With a 0.5 margin in favour of sk, 14/60 Czech clips would be rewritten into Slovak. Unsure audio therefore stays verbatim (Parakeet), which cannot translate. This is open question Q2.

## 3. Evidence

### 3.1 New benchmark (this plan)

Setup: Apple M5 Pro, the shipped `transcribe-cli` from `/Applications/Codevo Whisper.app` (same pinned commit), Metal. Models at the catalog revisions, SHA-256 verified: Parakeet Ultra Q8_0, Canary 1B v2 Q8_0, VoxLingua107 ECAPA Q8_0. Data: FLEURS test, 60 utterances each for sk_sk, cs_cz and en_us (seed 20261109). Crops of 1.0 / 1.5 / 2.0 / 3.0 s start 100 ms before speech onset (the owner's dictations in the server log are 1.5-2 s). Scripts and raw results: `/private/tmp/claude-501/-Users-matusmockor-Developer-codevo-whisper/834e5791-7911-4527-b685-7300afb91831/scratchpad/{scripts,bench}` (temporary; PR 0 copies them to `spikes/language-routing/`).

**LID top-1 accuracy, restricted to the allowed set:**

| Crop | [sk,cs,en]: sk / cs / en | [sk,cs]: sk / cs | [sk,en]: sk / en |
|---|---|---|---|
| 1.0 s | 49 / 42 / 56 | 51 / 44 | 55 / 56 |
| 1.5 s | 55 / 48 / 57 | 55 / 48 | 58 / 58 |
| 2.0 s | 59 / 52 / 60 | 59 / 52 | 59 / 60 |
| 3.0 s | 59 / 54 / 60 | 59 / 54 | 60 / 60 |
| full (4-20 s) | 60 / 57 / 60 | 60 / 57 | 60 / 60 |

sk vs en is easy. sk vs cs is the hard pair, and it gets worse below 2 s.

**Confidence gate, [sk,cs,en], 180 clips per crop: routed to Canary correctly / wrongly (= translation) / unsure:**

| Crop | p >= 0.9 | p >= 0.97 | p >= 0.99 |
|---|---|---|---|
| 1.5 s | 138 / 4 / 38 | 121 / 1 / 58 | 108 / **0** / 72 |
| 2.0 s | 147 / 4 / 29 | 138 / 3 / 39 | 125 / **0** / 55 |
| 3.0 s | 157 / 2 / 21 | 144 / 1 / 35 | 131 / **0** / 49 |
| full | 160 / 0 / 20 | 145 / 0 / 35 | 135 / **0** / 45 |

[sk,cs] gives the same picture (0 wrong at 0.99). [sk,en] at 2 s: 114 correct, 0 wrong, 6 unsure.

**`allowed_mass` is not a usable out-of-set signal on short clips.** With allowed = [sk] at 2 s, 15/60 Slovak clips have a mass below 0.5. Unrestricted LID on 2 s of Slovak picks sk only 45/60 times (sl, be, ru, uk, pl and others take the rest). That is why the foreign check needs another language to win with p >= 0.99 *among the 25 supported languages*, plus the text guard.

**Canary with a forced language (full clips, WER, diacritics kept):**

| Audio | Parakeet (no hint) | Canary sk | Canary cs | Canary en |
|---|---:|---:|---:|---:|
| sk | 7.5 | **6.8** | 58.2 | 116.4 |
| cs | 12.3 | 60.4 | **7.4** | 114.4 |
| en | **5.6** | 97.4 | 96.7 | 5.9 |

This confirms the research finding: a wrong hint means translation.

**Guard separability (character similarity of Canary(hint) to Parakeet, median):** a correct hint gives 0.89-0.94 at 2 s and 0.99 on full clips. A distant wrong language (sk/cs vs en) gives 0.23-0.35. A neighbour (sk vs cs) gives 0.81-0.89, which is **not separable**. The guard catches translations between distant languages and does not resolve sk vs cs. The confidence gate has to do that.

**Parakeet drift on FLEURS:** 0 outputs in Cyrillic or Greek across 540 clips. On Slovak, a Czech-only letter (ř, ě, ů) appeared in 1 of 180 outputs. **The owner's failure does not reproduce on clean read speech.** It is likely tied to real, spontaneous, short dictation with his microphone. See risk R1 and open question Q3.

**Whole pipeline (simulated from the runs above; the clips have no references at 2 s, so routes only):**

| Allowed | Speech | 2.0 s routes | Full WER (Parakeet alone) |
|---|---|---|---|
| [sk] | sk | 57 Canary-sk, 3 verbatim | 6.8 (7.5) |
| [sk] | en | 58 verbatim, 2 Canary-sk | 5.6 (5.6) |
| [sk] | cs | 40 Canary-sk (rewritten to Slovak), 20 verbatim | 39.0 (12.3), see Q1 |
| [sk,cs,en] | sk | 42 Canary-sk, 18 verbatim | 6.6 (7.5) |
| [sk,cs,en] | cs | 23 Canary-cs, 37 verbatim | 11.3 (12.3) |
| [sk,cs,en] | en | 53 Canary-en, 7 verbatim | 5.9 (5.6) |

For someone who dictates only Slovak, **[sk] alone is the most robust choice**: 57/60 short clips are forced to Slovak by Canary. Adding cs sends more Slovak clips to the verbatim fallback, where the drift can still happen.

**Latency and memory:**

- LID: 3.7 ms Metal / 12.5 ms CPU for 2 s of audio, 13.5 / 106 ms for 16.7 s. A cold CPU process takes 0.07 s with a 183 MB peak footprint.
- Canary warm: 0.14 s per 12 s utterance (research doc). Canary and Parakeet run in parallel in separate worker processes.
- Server, read-only check: RX 7800 XT with 16 GB VRAM, 1.7 GB used. The `stt` container uses 275 MiB of RAM (4 GiB limit). Disk has 519 GB free.

### 3.2 transcribe.cpp at the pinned commit

- LANGID role: `transcribe_model_load_file` gives `transcribe_model_roles() & TRANSCRIBE_ROLE_LANGID`. Then `transcribe_langid_session_init` and `transcribe_langid_run(session, pcm, n, {allowed, n_allowed})`, then `get_result` (`n_candidates`, `allowed_mass`) and `get_candidate(i)` (`code`, `p`, `logit`). The minimum audio is 500 ms (`TRANSCRIBE_ERR_INPUT_TOO_SHORT`). Only the first 30 s are scored. Labels are the model's own codes, and all 25 Canary/Parakeet languages exist in VoxLingua107.
- Several models can be loaded in one process, and different models compute in parallel ("one load per model, at most one compute in flight per model", `docs/roles.md`). The resident worker *could* hold LID and ASR together. The plan still keeps one model per worker process (section 6.1), for crash isolation and so the routing policy can stay in TypeScript.
- Canary: `run_params.language` is required (no autodetect), translation is a separate task, and **there are no word or segment timestamps in the port**. So Canary cannot serve meetings (section 9).
- Parakeet: no language input. `transcribe_detected_language` is empty, and there is no logit, script or vocabulary bias.

## 4. Rejected options

| Option | Why not |
|---|---|
| R1. Canary(primary) always, no LID | Translates every other language. Does not support several languages. |
| R2. LID then Canary(top), no gate | 4-9/180 translated at 2 s (sk/cs confusions). Breaks "never translate". |
| R3. LID with primary preference (margin 0.5 in favour of the first language) | 14/60 Czech clips at 2 s rewritten into Slovak (cs 46/60 vs 52/60 without the margin). |
| R4. Parakeet plus text heuristics only (script or letters), re-run Canary on mismatch | Catches Cyrillic. Czech-looking text without ř/ě/ů goes undetected, so it cannot enforce "only these languages", and cs accuracy stays at Parakeet's 12.3 %. Kept as a *component* (orthography check). |
| R5. Whisper Large v3 Turbo with a forced language | 2-5x slower (0.32 s warm), worse sk (8.6 % WER), and it partially translates with a wrong hint too. |
| R6. `allowed_mass` as the out-of-set detector | Unreliable below 3 s (15/60 Slovak clips under 0.5 at 2 s). |
| R7. LID and ASR policy inside the C worker | Puts product policy in C, harder to test, and duplicates it for the CLI engine. The C side only exposes LID scores. |
| R8. Routing in the gateway (several HTTP calls to stt) | Chatty, splits one decision across two processes, and the single-flight stt would see 3 requests per segment. |
| R9. Bump `PROTOCOL_VERSION` to `cw2` | Breaks pairing tokens (`cw1:` prefix) and the mobile app for no gain. Additive messages behind a version gate are enough. |

## 5. Languages offered

The intersection of the Parakeet Ultra, Canary 1B v2 and VoxLingua107 label sets is the same 25 languages: bg, cs, da, de, el, en, es, et, fi, fr, hr, hu, it, lt, lv, mt, nl, pl, pt, ro, ru, sk, sl, sv, uk. This is `DICTATION_LANGUAGES` in `packages/protocol`. Thresholds were calibrated only on sk, cs and en (risk R3).

UI order: Slovenčina, Čeština, Angličtina first, then the rest alphabetically by Slovak name: bulharčina, dánčina, estónčina, fínčina, francúzština, gréčtina, holandčina, chorvátčina, litovčina, lotyština, maďarčina, maltčina, nemčina, poľština, portugalčina, rumunčina, ruština, slovinčina, španielčina, švédčina, taliančina, ukrajinčina.

At most 5 selected languages. More candidates make LID less confident and push more audio to the verbatim fallback.

## 6. Architecture

### 6.1 Components (new or changed)

```
packages/language-routing      (new, pure TS, no I/O)
  LanguageSelection            ordered, validated codes; primary(); has(code)
  LanguageScores               LID output; restrictedTo(set); top(); foreignWinner(set, threshold)
  RoutePolicy                  Strategy: (selection, scores, segmentMs) -> RouteDecision
                               ConfidentRoutePolicy (0.99 gate; 1 language vs several)
  OrthographyCheck             per-language alphabet table; isConsistent(text, selection)
  TranslationGuard             fold + char similarity; accepts(conditioned, verbatim, selection)
  RoutedTranscriber            orchestrator; ports: LanguageIdentifier, ConditionedTranscriber,
                               VerbatimTranscriber; returns { text, language | null, route }
  RouteCounters                per-session counts for the dictation log (no text)

packages/stt-runner
  worker/resident-worker.ts    ResidentTranscriber's process, queue, backoff and timeout logic,
                               extracted and generic over a FrameCodec (Strategy)
  worker/resident-transcriber  thin: ASR codec (language tag widened to the 25 codes)
  worker/resident-language-identifier  thin: LID codec -> LanguageScores rows
  worker/langid-frames.ts      encode 0xFE frame, parse "code p" reply lines
  run-language-id-cli.ts       CLI fallback (transcribe-cli --allow ... --top 0), for STT_ENGINE=cli

native/stt-worker
  stt-worker.c                 loads the model via transcribe_model_load_file, reads the roles,
                               serves ASR (as today) or LANGID
  stt-worker-langid.c (new)    LID request parse + run + reply
  stt-worker-request.c         language whitelist = 25 codes; new 0xFE LID header parser
```

Worker LID frame (little endian, the ASR framing is unchanged):

```
0xFE | n_allowed:u8 (1..32) | n_allowed x (len:u8 (2..3), ascii code) | samples:u32 | pcm s16le
reply OK text: one "code p" line per allowed code, ranked, p over the allowed set
```

The TS side always sends allowed = the 25 supported codes. It renormalises over the user's selection itself, so one LID run answers both "which of A" and "is it foreign". A request for a LID model to an ASR worker, or the reverse, gets `REPLY_FAILED "wrong role"`.

### 6.2 Routing algorithm (RoutedTranscriber, final segments)

```
if selection is auto                 -> verbatim(pcm)                                   route 'auto'
if segment < 500 ms                  -> verbatim(pcm)                                   route 'verbatim-short'
scores = lid(pcm, SUPPORTED)
if scores.foreignWinner(selection, 0.99)  -> verbatim(pcm)                              route 'verbatim-foreign'
top = scores.restrictedTo(selection).top()      (ties -> earlier in selection order)
confident = selection.size == 1 or top.p >= 0.99
if !confident:
   v = verbatim(pcm)
   if orthography.isConsistent(v, selection) -> v                                       route 'verbatim-unsure'
   -> conditioned(pcm, top.code)                                                        route 'conditioned-fix'
[c, v] = parallel(conditioned(pcm, top.code), verbatim(pcm))
if orthography.isConsistent(v, selection) and !guard.accepts(c, v) -> v                route 'verbatim-guard'
-> c                                                                                    route 'conditioned'
```

Partials (live overlay only): LID, then a single model (Canary if confident, otherwise Parakeet), no guard. The final result replaces them.

Thresholds (0.99 gate, 0.99 foreign, 0.5 guard) live in one `RoutingThresholds` value. They are set in code from the calibration in PR 0 and are not user settings.

The returned `language` is `top.code` for conditioned routes and `null` for verbatim routes.

### 6.3 Where it runs

- **Server:** `apps/stt` builds a `RoutedTranscriber` from three resident workers: Parakeet (`STT_MODEL_PATH`, Vulkan), Canary (`STT_CONDITIONED_MODEL_PATH`, Vulkan) and LID (`STT_LID_MODEL_PATH`, `STT_LID_BACKEND=cpu` by default, so it does not compete for the GPU). If either extra model is missing, stt logs `language_models_missing`, keeps serving auto, and reports `languages: []`.
- **Desktop local:** `LocalEngine` gets a second generation type, `RoutedGeneration`. It holds the same three residents with the existing idle-unload policy, and is created only when the selection is restricted.

## 7. Settings model and migration

```ts
export type LanguageMode = 'auto' | 'selected';
export type LanguageSelection = { mode: LanguageMode; selected: readonly DictationLanguage[] };
Settings.languages: LanguageSelection;              // replaces Settings.language
DEFAULT_SETTINGS.languages = { mode: 'auto', selected: ['sk'] };
```

- `selected` holds 1-5 unique codes from `DICTATION_LANGUAGES`, in order, and the first one is the primary. It is kept when the mode is `auto`, so switching back is one click (tray and Settings).
- `SETTINGS_FIELDS.languages` validates the shape. `language` is removed from `Settings`, `TranscriptSettings`, `DictationOptions`, `LocalContext` and the tray model.

Migration is one-shot, in `settings-wiring` after the catalog is parsed. `SettingsStore.load()` exposes the raw legacy `language` value through a `LegacySettingsReader`, because `sanitizeSettings` drops unknown keys.

| Stored state | Result |
|---|---|
| `languages` present and valid | Keep it. |
| Legacy `language` = `sk`/`cs`/`en` and the active local model has `languageHint: 'required'` (Canary) | `{ mode: 'selected', selected: [language] }`. Keeps today's forced-language behaviour. |
| Legacy `language` = `sk`/`cs`/`en`, any other case (Parakeet: the value had no effect; Whisper Turbo: auto-detect was 90/90 in the research) | `{ mode: 'auto', selected: [language] }`. |
| Legacy `language` = `auto`, or none | `DEFAULT_SETTINGS.languages`. |

The result is written once, so later loads no longer see the legacy key. The owner's file (`language: "sk"`, server only) becomes `{ auto, ['sk'] }`. Behaviour does not change, and restricting to Slovak is one click.

Canary as the *active* local model keeps working, but only in `selected` mode. `language-required` becomes `languages-required` ("Zvolený model potrebuje zvolené jazyky"). `LanguagePrompt` sets `{ mode: 'selected', selected: [choice] }`.

## 8. Protocol, gateway and server changes

### 8.1 Protocol (`packages/protocol`, additive, `cw1` unchanged)

- `DICTATION_LANGUAGES` (the 25 codes) and `DictationLanguage`. The legacy `LANGUAGES` (sk/en/cs/auto) stays, because the mobile app and older desktops use it.
- `ClientMessage` gains `{ type: 'capabilities' }`. It is valid only in idle state, before `start`.
- `ServerMessage` gains `{ type: 'capabilities'; languages: DictationLanguage[] }`. The list is empty when routing is unavailable.
- `start` gains optional `languages: DictationLanguage[]` (1-5, unique). When present, `language` must be `'auto'`, and the server routes. When absent, it is today's behaviour exactly: the hint is passed through, and Parakeet ignores it.
- `final` and `partial` gain optional `language: DictationLanguage | null`. They are sent **only** to sessions that started with `languages`.
- `ERROR_CODES` gains `languages_unavailable`. It is sent only in reply to a `start` with `languages`, for example when the models disappeared after the capability check.

Compatibility: decoding is strict (`assertOnlyKeys`) on both sides, so nothing new may reach a peer that does not know it.

| Pair | What happens |
|---|---|
| New client, old server (<= 0.2.x) | The client sees `serverVersion < 0.3.0`, never sends `capabilities` or `languages`. Auto mode works; restricted mode is refused locally with a "server je zastaraný" message. |
| New client, new server without the models | `capabilities.languages = []`, so restricted mode is refused with a "chýbajú modely" message. Auto mode works. |
| Old client or mobile app, new server | Sends only the legacy `start` and never receives the new fields. No change. |
| New client, new server | Full feature. |

The gate is `serverVersion >= 0.3.0` (semver compare in a small `ServerFeatures` value). `apps/server/package.json` is still at `0.2.0` after many releases, so **PR 6 must bump it to `0.3.0`**. CI guards it with a test that the server version is >= the feature's minimum.

### 8.2 Gateway (`apps/server`)

- `SttCapabilities` port, implemented by `HttpSttClient.capabilities()`, which calls `GET /capabilities`. A 404 from an old stt means `languages: []`. The result is cached and refreshed on the existing health cadence and on connection.
- `SessionHandler` handles `capabilities` in idle state, and `start.languages` is validated against the cache.
- `GatewayContext` = `{ language: Language; languages: readonly DictationLanguage[] | null }`.
- `SttClient.transcribe(request: SttRequest)` with `SttRequest = { pcm, language, languages, kind }`. The URL becomes `POST /transcribe?language=auto&languages=sk,cs&kind=final`. The reply `{ text, language?, route? }` is parsed with the same size limits.
- `Dictation.forward` adds `language` only for language sessions. `dictation-log` adds `routes` counts (no text, no language of individual segments beyond counts) for calibration.

### 8.3 STT sidecar (`apps/stt`)

- Config: `STT_CONDITIONED_MODEL_PATH` (default `/models/canary-1b-v2-Q8_0.gguf`), `STT_LID_MODEL_PATH` (default `/models/lang-id-voxlingua107-ecapa-Q8_0.gguf`), `STT_LID_BACKEND` (default `cpu`).
- `GET /capabilities` returns `{ languages: [...] }` (empty when routing is not ready). `/health` is unchanged.
- `/transcribe` accepts `languages` (validated against `DICTATION_LANGUAGES`, 1-5) and `kind`. With `languages` it calls `RoutedTranscriber`, without it the plain transcriber (today's path). It stays single-flight.
- Provisioning: `provision.ts` gets a `ServerModelManifest`, a list of `{ url, sha256, target }` with pinned revisions:
  - Parakeet Ultra F16: unchanged, `a1539be1...`, `cd97f94f...`.
  - Canary 1B v2 Q8_0: `handy-computer/canary-1b-v2-gguf@692af661b140183b60e44f55ad03c59e1e77d078`, 1,144,290,016 B, `224f83d1bc487b3303b495a7d6874912fdece93de19d1a04b550829c30a5d289`.
  - VoxLingua107 ECAPA Q8_0: `handy-computer/lang-id-voxlingua107-ecapa-gguf@e59f0f3847e77723b7d58447ef9456fa0c7e9436`, 26,693,632 B, `063e6cb0af3d53085fc7d68356dfde5ecee2ffa7bc79855f7e4ff930081bfe3a`.

  `provision-cli` loops over the manifest (each file present-and-verified, or downloaded-and-verified) and prints the extra 1.17 GB.

  The Q8 Canary file is the same one the desktop catalog uses, so local and server routing give identical text. F16 (1.97 GB) is possible later, but is not needed: on our sets the difference is inside the CI.
- Dockerfile: the new env defaults. The worker binary already contains the CPU backend for LID.
- Compose: env passthrough for the three paths and `STT_LID_BACKEND`, and `mem_limit` stays 4g (to verify, section 12.3). `stt-provision` is unchanged apart from downloading more files.

### 8.4 Native systemd variant

`scripts/install-server-service.sh` adds `STT_CONDITIONED_MODEL_PATH` (default `~/.config/Codevo Whisper/models/canary-1b-v2-q8.gguf`) and `STT_LID_MODEL_PATH` (default `~/.config/Codevo Whisper/models/langid-voxlingua107-q8.gguf`; desktop files are named `<catalog id>.gguf`). Missing files are a warning, not a failure ("Výber jazykov nebude dostupný, stiahnite Canary 1B v2 a rozpoznávanie jazyka v aplikácii"). The script copies them like the worker, so the service survives a removed app.

### 8.5 Docs

- `docs/operations/server-setup.md`: the three-model provisioning (revisions, hashes, sizes), "Výber jazykov" verification (`curl` to `/capabilities` from inside the gateway container), the env vars, the systemd section, and the Overené section after the real-server test.
- `docs/research/language-routing.md`: the benchmark from section 3.1 plus the calibration results.

## 9. Meetings, AI polish, filler words, overlay, tray

- **Meetings** (`meeting-transcriber.ts`): they need word timestamps for speaker attribution, and Canary has none in the port. So meetings always run the verbatim model with no hint. The one exception is the Whisper Turbo active model when exactly one language is selected: then `--language` is passed, as today. The `--language` built from `settings.language` is removed. Settings note: "Výber jazykov platí pre diktovanie. Stretnutia sa prepisujú s automatickým rozpoznaním jazyka." A later option, out of scope: LID per meeting track to fill the notes language.
- **AI polish** (`prompts.ts`): already "keep the language, do not translate". No dependency on the setting. Optional later: pass the routed `language` as a hint in the user JSON.
- **Filler words** (`process-final-transcript.ts`): keyed by the selection instead of `language`: the union of the fillers of the selected languages, or the auto list when the mode is auto or a language has no list.
- **Overlay chip**: `AUTO` in auto mode. Otherwise the primary code, plus a count when there are more (`SK`, `SK +2`). After a final that carries `language`, the chip may show it (phase 2).
- **Tray "Jazyk" submenu**: `Automaticky` (radio), `Zvolené: SK, CS, EN` (radio, switches the mode), separator, `Upraviť jazyky…` (opens Settings).

## 10. UI behaviour and copy (Slovak; hyphens only, no long dashes)

Settings > Diktovanie, the row that replaces "Jazyk":

- Title: **Jazyky diktovania**
- Segmented control: `Automaticky` | `Zvolené jazyky`
- Description, auto: "Jazyk rozpozná model sám. Je to najrýchlejšie, pri krátkych vetách sa však môže pomýliť, napríklad napísať slovenčinu po česky."
- Description, selected: "Prepíše sa len v zvolených jazykoch. Prvý jazyk je hlavný. Keď si aplikácia nie je istá jazykom, ponechá text tak, ako zaznel, a nič neprekladá."
- List (selected mode): checkboxes for the 25 languages in section 5 order. Each checked row has a `Hlavný` badge on the first one and `Vyššie` / `Nižšie` buttons (keyboard accessible, no drag-only control).
- Limit message: "Zvoliť môžete najviac 5 jazykov."
- Empty-selection guard: the last checked language cannot be unchecked ("Aspoň jeden jazyk musí zostať zvolený.").
- Hint with a single language: "Reč v príbuznom jazyku, napríklad v češtine, sa prepíše v zvolenom jazyku. Ak hovoríte aj ňou, pridajte ju."

Availability notes under the row, depending on the engine order:

- Server, OK: "Server podporuje výber jazykov."
- Server too old: "Server je zastaraný (verzia {v}). Výber jazykov funguje od verzie 0.3.0, aktualizujte server."
- Server without models: "Na serveri chýbajú modely pre výber jazykov. Spustite na serveri stt-provision."
- Local without the pack: "Pre výber jazykov treba stiahnuť Canary 1B v2 (1,1 GB) a rozpoznávanie jazyka (27 MB)." Button: `Stiahnuť`.

Server page card, new `dt`/`dd`: "Výber jazykov" with `Podporovaný` / `Server je zastaraný` / `Chýbajú modely` / `-` (unknown).

Overlay readiness errors (new `EngineUnavailableReason`s):

| Reason | Message | Action |
|---|---|---|
| `server-languages-outdated` | "Server nepozná výber jazykov. Aktualizujte ho alebo zapnite Automaticky." | open-server |
| `server-languages-missing` | "Na serveri chýbajú modely pre zvolené jazyky." | open-server |
| `languages-pack-missing` | "Pre zvolené jazyky chýbajú modely. Stiahnite ich v Nastaveniach." | open-settings |
| `languages-required` | "Zvolený model potrebuje zvolené jazyky." | open-settings |

With `engineOrder` `['server', 'local']`, the `EngineSelector` falls back to local when the server returns a `server-languages-*` reason. Neither engine ever silently ignores the restriction.

Remove the misleading `AUTO_LANGUAGE_NOTE` ("pridá k prvému slovu asi 0,1 s").

## 11. Phased task list (separate PRs)

Each PR follows the owner's rules: SOLID, small units, guard clauses, no `else`, no comments, integration tests through real collaborators (native processes are replaced only by the existing fake-worker or fake-CLI scripts, which is the true process boundary), no `throw` in tests. Verify each PR with lint, typecheck and tests, not builds (the Docker build only in PR 5 and PR 6, where the image is the deliverable).

| # | PR | Scope | Depends |
|---|---|---|---|
| 0 | `docs/language-routing-calibration` | Move the bench scripts to `spikes/language-routing/`, add `docs/research/language-routing.md`. Run them on the owner's real samples (Q3) and fix the thresholds. | - |
| 1 | `feat/native-langid-worker` | `stt-worker.c` role dispatch, `stt-worker-langid.c`, 25-code whitelist, stub header for C tests, request tests and fuzz corpus for 0xFE frames, `worker-smoke.js` against the real LID model (optional, gated like the existing real tests). | - |
| 2 | `feat/stt-runner-language-id` | Extract `ResidentWorker` with a `FrameCodec`. Add `ResidentLanguageIdentifier`, `langid-frames`, `runLanguageIdCli`, and widen `TranscribeLanguage` to the 25 codes. Extend `fake-worker.js` with the LID role. | 1 |
| 3 | `feat/language-routing-package` | `packages/language-routing`: selection, scores, policy, orthography table, guard, `RoutedTranscriber`, counters. Tests drive `RoutedTranscriber` with real `ResidentTranscriber` and `ResidentLanguageIdentifier` instances on scripted fake workers. | 2 |
| 4 | `feat/protocol-language-sets` | Protocol additions from 8.1, encode/decode tests, extended fuzz test, and a mobile compile check (`apps/mobile` still typechecks). | - |
| 5 | `feat/stt-language-routing` | stt config, `/capabilities`, routed `/transcribe`, manifest provisioning, Dockerfile/compose env, tests with the fake CLI/worker. | 2, 3 |
| 6 | `feat/gateway-language-sets` | Gateway capability cache, `capabilities` message, `start.languages`, `SttRequest`, `final.language`, new error, route counts in the log, server version 0.3.0, `server-setup.md`, `install-server-service.sh`. | 4, 5 |
| 7 | `feat/desktop-language-settings` | `Settings.languages`, migration, Jazyky diktovania UI, tray, overlay chip, filler words, meetings hint rule, removal of `language` everywhere. Restricted mode on the server is still blocked until PR 8. | 4 |
| 8 | `feat/desktop-server-languages` | `ServerFeatures` version gate, capability query in `ServerConnector`, `RemoteEngine` readiness reasons, `start.languages`, server card row, overlay messages. **This is the PR that fixes the owner's problem.** | 6, 7 |
| 9 | `feat/desktop-local-languages` | Catalog `languageId` auxiliary entry (like `diarizer`), the pack download prompt, `RoutedGeneration` in `LocalEngine`, `languages-pack-missing`. | 3, 7 |
| 10 | `feat/language-memory` (optional) | Per-dictation memory: an unsure segment whose restricted top equals the language of an earlier confident segment goes to Canary. | 3 |

The minimum to ship for the owner is PRs 1-8 (and 0 for calibration). PR 9 can follow (Q4).

## 12. Test plan

### 12.1 Unit and integration (vitest, no GUI, runnable on this Mac)

- **`packages/language-routing`**:
  - Policy table tests built from real LID score rows taken from the benchmark: confident, unsure, foreign, a single language, ties resolved by order, and segments under 500 ms.
  - The guard on real Canary/Parakeet text pairs from the benchmark: a translation is rejected, a correct pair is accepted, and Cyrillic verbatim text never wins over Latin Canary text for a Latin selection.
  - The orthography table for all 25 languages.
  - `RoutedTranscriber` with real resident workers on fake worker scripts: the routes, the parallel calls, and abort propagation. The verbatim result never contains text from a different call.
- **`packages/stt-runner`**: LID frame encode tests (limits, unknown code), reply parsing (ranked lines, malformed, oversized), `ResidentLanguageIdentifier` lifecycle (start, crash, backoff, abort) through the shared `ResidentWorker`, and the CLI fallback parser on recorded CLI output.
- **`native/stt-worker`**: `run-tests.sh` covers 0xFE parse (complete, incomplete, invalid counts and codes, max samples), role mismatch replies, and the 25-code whitelist. Fuzz corpus entries for the new frame.
- **`packages/protocol`**:
  - The new messages round-trip.
  - The strictness holds: a legacy decoder rejects `languages`. This test documents why the version gate exists.
  - `start` with `languages` and `language` other than `auto` is rejected, as is `languages` with more than 5 entries or duplicates. The fuzz test covers the new types.
- **`apps/stt`**:
  - `/capabilities` with and without models.
  - `/transcribe` with `languages`, through the real `RoutedTranscriber` on fake workers.
  - 400 for invalid lists.
  - Provisioning manifest: present, downloaded and mismatched files for each entry, using the existing fetch stub, which is the true HTTP boundary.
  - Config tests for the new env vars.
- **`apps/server`** (`gateway-session`, `http-stt-client`, `fake-stt-server`):
  - The capabilities message before start.
  - `start.languages` accepted or refused depending on the stt capabilities.
  - `final.language` only for language sessions.
  - The legacy start is byte-identical to today, so the mobile client test stays green.
  - `languages_unavailable`.
  - The route counts in the log.
- **`apps/desktop`**:
  - Settings migration table (section 7), on real settings files in a temp dir.
  - `sanitizeSettings` and the IPC validation for `languages`.
  - `ServerFeatures` version compare.
  - `RemoteEngine` readiness reasons against the in-process local gateway harness.
  - `RemoteDictation` sends `languages` and accepts `final.language`.
  - Tray template, overlay chip, filler words per selection, the meeting CLI args rule.
  - `LocalEngine` with a routed generation on fake workers.
  - EngineSelector falls back to local on `server-languages-*`.

### 12.2 E2E (Playwright; run later under xvfb on Linux, never on the owner's Mac)

Specs to update or extend:

- `settings.spec.ts`: the "Jazyk" persistence test becomes "Jazyky diktovania": mode, multi-select, order, and persistence across a relaunch.
- `linux-settings.spec.ts`
- `server.spec.ts`: server card row, outdated and missing-models states via `e2e/local-gateway.ts`.
- `overlay.spec.ts` and `linux-overlay.spec.ts`: chip text.
- `onboarding.spec.ts`: the Canary language prompt sets `selected`.
- `linux-dictation.spec.ts`, `linux-delivery.spec.ts`, `linux-meetings.spec.ts`: their `createUserDataDir({ language: 'en' })` fixtures exercise the migration path. Keep one legacy fixture on purpose, move the rest to `languages`.

New: `languages.spec.ts`. Restricted mode against the local gateway harness with a fake stt that echoes the received `languages`. Checks the inserted text and that an outdated server shows the overlay error.

### 12.3 Real home server, without touching the running stack

The live stack is compose project `codevo-whisper`, built from `/home/codex/Developer/codevo-whisper` (checkout at `02d9c6a`), with volumes `codevo-whisper_cw-*` and gateway `127.0.0.1:8787`. Rules for the test:

1. Use a **separate checkout**, for example `git worktree add ~/Developer/codevo-whisper-langtest <branch>`. Never pull or build in the live checkout.
2. Use a separate project name and image tags: `docker compose -p cw-langtest -f compose.yaml -f compose.langtest.yaml`. The override sets `image: codevo-whisper-{gateway,stt}:langtest`, the port `127.0.0.1:18787:8787` and its own `.env`. Volumes are automatically `cw-langtest_*`: a fresh server key and devices, and a separate models volume.
3. Provision: `docker compose -p cw-langtest --profile provision run --rm stt-provision`. This downloads about 2.4 GB into `cw-langtest_cw-models`. Disk has 519 GB free.
4. Shared resources: the same render node and GPU (VRAM 16 GB, 1.7 GB used, so the extra ~1.5 GB fits). Tests can briefly slow the live stt on contention, so run them when the owner is not dictating.
5. Pair a test client with `docker compose -p cw-langtest exec gateway codevo-whisper pair` and the dev client from `server-setup.md`. Stream the benchmark WAVs and the owner's samples with `languages=[sk]`, `[sk,cs,en]` and none. Record routes, latency per segment (p50 and p95), `docker stats` memory against the 4 GiB limit, and VRAM before and after.
6. Tear down with `docker compose -p cw-langtest down -v`, `docker image rm codevo-whisper-{gateway,stt}:langtest`, and `git worktree remove`.
7. Only after the owner approves: deploy to the live project (pull in the live checkout, `--profile provision run --rm stt-provision`, `up -d --build`). Old desktops keep working, because they never send the new fields.

## 13. Risks

| # | Risk | Mitigation |
|---|---|---|
| R1 | The owner's drift (Czech spelling, Cyrillic) does not reproduce on FLEURS. Thresholds are calibrated on clean read speech; real 1-2 s spontaneous dictation may give more unsure LID, so more verbatim fallbacks where the drift remains. | PR 0 calibration on real samples (Q3); route counts in the server log; single-language mode forces Canary for 57/60 short Slovak clips. |
| R2 | Single-language mode rewrites a close neighbour (Czech speech with only sk) into the selected language (2/3 of Czech clips). | Explicit UI hint; the owner decides (Q1). |
| R3 | Thresholds are measured only for sk, cs and en; the other 22 languages are untested, and LID is weaker for some pairs (hr/sl, ru/uk, da/sv). | Offer them, but default nothing; extend calibration when someone uses them; the guard still blocks distant-language translations. |
| R4 | Extra latency: LID plus Canary and Parakeet in parallel instead of Parakeet. About +0.1 s per segment on Metal (measured components). Server Vulkan not yet measured. | Measure in 12.3; LID on CPU; partials skip the guard. |
| R5 | Local memory: Parakeet 0.74 GB + Canary 1.14 GB + LID 0.03 GB mmapped, plus working sets of about 0.5 GB. Tight on 8 GB Macs. | The existing idle-unload policy covers all three residents; the pack is opt-in; `minRamBytes` check before offering it. |
| R6 | Version gating depends on bumping the server version. | A test asserts that `SERVER_VERSION >= LANGUAGE_SETS_MIN_VERSION`. |
| R7 | LID on Vulkan is untested. | Default `STT_LID_BACKEND=cpu` (12.5 ms per 2 s on CPU). |
| R8 | Canary on very short or near-silent segments may hallucinate. | The 500 ms floor goes to verbatim; the guard rejects outputs that diverge from Parakeet. |
| R9 | Upstream GGUF repos are young. | Pinned revisions and SHA-256 in both catalogs; the provisioning verifies the hashes. |

## 14. Open questions for the owner

1. **One language and Czech speech.** With only Slovenčina selected, Czech speech is written in Slovak about 2/3 of the time (English is detected and kept as spoken). Is that acceptable? The alternative is to tell people who also speak Czech to add Čeština.
2. **Unsure language.** You asked to prefer the first language when recognition is unsure. The measurements show that unsure clips are mostly the *other* language, so the plan keeps unsure audio as spoken (Parakeet, no translation) instead of forcing the first language. Agree?
3. **Real samples.** Can you record 20-30 short real dictations (Slovak, plus a few Czech and English, ideally including ones that came out Czech or in Cyrillic) as WAV files for calibration? Dictation audio is not stored today, and FLEURS does not reproduce the problem.
4. **Local Mac support in the first release.** You transcribe on the server only. Ship the server path first (PRs 1-8) and the local language pack (1.1 GB download) as a follow-up?

### Owner answers (2026-11-12)

1. The owner wants to pick several languages to dictate in (the "several languages" mode). One-language behaviour on Czech speech is not a blocker.
2. Unsure audio stays as spoken (Parakeet verbatim). No forcing of the first language.
3. No real samples. Start with the FLEURS thresholds and tune later.
4. Server path first (PRs 1-8). The local language pack (PR 9) follows.
