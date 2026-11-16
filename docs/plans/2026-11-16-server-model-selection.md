# Server transcription model selection (backend)

Goal: every paired device chooses which transcription model the server uses for its dictations. Parakeet Ultra F16 stays resident and the default; Whisper Large v3 F16 GGUF runs on the same transcribe.cpp worker, is loaded on first use and then kept resident. The choice is per session, devices never affect each other's model.

Scope of this plan: `apps/stt`, `packages/protocol`, `apps/server`, compose and provisioning. The desktop picker is a separate task that builds on the contract below.

## Decisions

- Stable ids `parakeet-ultra` (default) and `whisper-large-v3`, names "Parakeet Ultra (F16)" and "Whisper Large v3 (F16)" (`model-names.ts`).
- Whisper bypasses Canary and the language ID. The language hint is the selected language when exactly one is selected, otherwise `auto` (Whisper detects the language itself). The legacy `language` (`sk`, `en`, `cs`, `auto`) is passed through as the hint.
- Only the default model routes dictation languages (Canary + language ID); every other offered model transcribes directly. The rule is `routesDictationLanguages` in `packages/protocol` (no model or the option with `default: true`), shared by the gateway and the desktop, so the wire contract stays as it is. A `start` with `languages` is checked against `capabilities.languages` (and refused with `languages_unavailable`) only when its model routes; a direct model accepts any valid language list even when the sidecar reports `languages: []`. The desktop applies the same rule before it refuses a dictation with `server-languages-missing`.
- Vocabulary is sent to Whisper exactly as to Parakeet. `cw-stt-worker` (`stt-worker-asr.c`) only hands it to transcribe.cpp when the model reports `TRANSCRIBE_FEATURE_VOCABULARY`, otherwise the terms are dropped, so it is safe for any model.
- Language codes: the worker frame accepts the 25 `LANGUAGE_CODES`, all of them are Whisper languages.
- Whisper file: `handy-computer/whisper-large-v3-gguf` @ `274ad1d1cf680b7ee53cc70f78461394cd3a344b`, `whisper-large-v3-F16.gguf`, 3,107,236,640 B, SHA-256 `e633ab1d74b0e98f4f57daedaee34291297dbbf01389bda3d890766600c1c584`, MIT (OpenAI Whisper). The server side carries no attribution files today, so none are added.
- Lazy load, outside the inference slot: the gateway serves every segment through one dispatcher slot, so a load must never happen inside a transcription request. A session that starts with a non-default model asks the sidecar to prepare it (`POST /prepare`) right at `start`. Its segments wait for that answer in a per-session gate in front of the dispatcher (`ModelReadyGate`), so they never occupy the slot while the model loads and other devices keep dictating on Parakeet. Partials of that session are dropped (`model-loading`) until the model is ready; cancel or a failed segment drops the waiting segments. The sidecar starts one shared warm-up per model (single flight, not bound to the request, so an aborted request does not kill the load). A `/transcribe` for a model that is not loaded yet never waits: it starts the warm-up and answers `503 model loading` at once; the gateway then waits for the model again outside the slot and resubmits the segment (at most 3 loads per segment, then `stt_unavailable`). A failed load fails the segments of that session with `stt_unavailable` and is retried by the next preparation (the worker's restart backoff applies).
- A missing Whisper file is not fatal: the model is reported with `available: false`, requests for it get 409.
- `stt` `mem_limit` default raised from `4g` to `8g` (`STT_MEM_LIMIT` still overrides).

## Wire contract

### STT sidecar (internal HTTP)

- Env `STT_WHISPER_MODEL_PATH`, default `/models/whisper-large-v3-F16.gguf`.
- `POST /prepare?model=<id>` (no body) loads the model and answers when it is resident. Without `model` it prepares the default model, which is always ready.
  - ready: `200 {"status":"ready"}` (at once when the model is already resident)
  - unknown id: `400 {"error":"unknown model"}`
  - known but file missing: `409 {"error":"model unavailable"}`
  - load failed: `502 {"error":"model failed to load"}`
- `POST /transcribe?...&model=<id>`. Without `model` the default model serves the request, exactly as today.
  - unknown id: `400 {"error":"unknown model"}`
  - known but file missing: `409 {"error":"model unavailable"}`
  - model not loaded yet: `503 {"error":"model loading"}` at once, the load starts in the background (only a request with `model` can get it, so older gateways never see it)
  - Whisper with `languages`: `200 {"text":"...","language":<the single selected language or null>,"route":"direct"}`
- `GET /capabilities` gains `transcriptionModels`:

```json
{"languages":[...],"models":{...},"transcriptionModels":[
  {"id":"parakeet-ultra","name":"Parakeet Ultra (F16)","available":true,"default":true},
  {"id":"whisper-large-v3","name":"Whisper Large v3 (F16)","available":true,"default":false}]}
```

### Protocol (`cw1`, additive)

Decoding is strict on both sides (`assertOnlyKeys`), so the existing compat mechanism applies: new keys only travel when the peer is known to understand them. The client learns the server version from `ready` and gates on `TRANSCRIPTION_MODELS_MIN_VERSION = '0.5.0'` (server version bumped to 0.5.0). The server learns nothing about the client, so the new reply field is opt-in per request.

- Client `capabilities` gains `transcriptionModels?: boolean`. Only `true` makes the server add the list. Send it only to servers `>= 0.5.0`; an older server answers `bad_message`.
- Server `capabilities` gains `transcriptionModels?: TranscriptionModelOption[]`, present only when requested. `TranscriptionModelOption = { id: string; name: string; available: boolean; default: boolean }`. `id` matches `/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/`, at most 64 characters; `name` follows the model name rule (64 printable characters); at most 8 entries, unique ids, at most one default. An empty list means the stt sidecar predates model selection or is unreachable: hide the picker.
- Client `start` gains `model?: string` (same id rule). Omitted means the default model. Send it only to servers `>= 0.5.0`.
- `ERROR_CODES` gains `model_unavailable` at the end (close code 4011). It is sent only to a `start` that carried `model`: at start when the id is not in the cached list or not available (`{type:'error', code:'model_unavailable', message:'model_unavailable', sessionId}`, the connection stays open), or as the session's error when the stt refuses the model mid-session.

| Pair | Behaviour |
|---|---|
| Old client, new server | Never sends `transcriptionModels` or `model`; gets the default model and the old `capabilities` shape. |
| New client, old server (< 0.5.0) | Gate is closed: no list, no picker, no `model`. |
| New client, new server, old stt | `transcriptionModels: []`, picker hidden; a `start.model` is refused with `model_unavailable`. |
| New client, new server, new stt | Full feature. |

## Steps

1. Protocol: `transcription-models.ts` (option type, id rule, list validator), optional fields on `capabilities` (both directions) and `start`, `model_unavailable`, `TRANSCRIPTION_MODELS_MIN_VERSION`. Tests: round trips, limits, legacy-decoder documentation, close code order.
2. stt: config, `TranscriptionModel` strategy (`RoutingTranscriptionModel` for Parakeet + routing, `DirectTranscriptionModel` for Whisper), `TranscriptionModelCatalog` registry, `SingleFlightWarmUp`, `model` query param, capability report, `createEngine` wiring, `main.ts` file check and log, manifest entry, model name. Tests with the fake worker binary through the real HTTP server.
3. Gateway: `SttCapabilityReport.transcriptionModels`, `CapabilityLookup.offersModel`, `SttRequest.model`, `GatewayContext.model`, start validation, `model_unavailable` mapping, `ModelPreparation` (`HttpSttClient.prepare`, own 5 min timeout), `ModelReadyGate` in front of the dispatcher, server version 0.5.0. Tests through the real gateway and the fake stt server (which simulates a slow load).
4. Compose (`x-model-paths`, `mem_limit`), Dockerfile env, `server-setup.md`.
5. `pnpm lint`, `pnpm typecheck`, `pnpm test`.

## Known limits

- A dictation with `languages` on the default model is still checked against `capabilities.languages`, which needs Canary and the language ID; with the pinned provisioning all models are present.
- The preparation has its own 5 min timeout (the per-request STT timeout of 40 s applies only to transcription). A dictation started with a model that is still loading waits for it, so its first transcript comes only after the load; partials of that dictation start once the model is ready.
- Real Whisper load and inference on Vulkan (RX 7700/7800 XT) is not covered by the automated tests, which use the fake worker.
