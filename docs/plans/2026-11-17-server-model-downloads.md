# Server model downloads (backend)

Goal: an authorized desktop app downloads and removes server transcription models itself, instead of the admin provisioning every file with `stt-provision`. The models come only from a pinned catalog. Every paired device can still choose a model for its dictations (2026-11-16 plan); downloading and removing needs a per-device permission granted with the admin CLI.

Scope of this plan: `apps/stt`, `packages/protocol`, `apps/server`, compose and docs. The desktop UI is a separate task that builds on the contract below.

## Decisions

- Pinned catalog, one source of truth in `apps/stt/src/pinned-models.ts` (files, names, Hugging Face repo, revision, size, SHA-256). `ServerModelManifest` (provisioning), `modelName` and `pinnedCatalog` (`catalog-models.ts`) all read it. No URL ever comes from a client.

  | Id | Family | File | Size |
  |---|---|---|---|
  | `parakeet-ultra` (default, not removable) | parakeet | `parakeet-ultra-F16.gguf` | 1,256,724,448 B |
  | `parakeet-ultra-q8` | parakeet | `parakeet-ultra-Q8_0.gguf` | 740,363,168 B |
  | `whisper-large-v3` | whisper | `whisper-large-v3-F16.gguf` | 3,107,236,640 B |
  | `whisper-large-v3-q8` | whisper | `whisper-large-v3-Q8_0.gguf` | 1,668,741,440 B |
  | `whisper-large-v3-turbo` | whisper | `whisper-large-v3-turbo-F16.gguf` | 1,625,935,488 B |
  | `whisper-large-v3-turbo-q8` | whisper | `whisper-large-v3-turbo-Q8_0.gguf` | 886,381,728 B |

  Repositories and revisions: `handy-computer/parakeet-ultra-gguf` @ `a1539be1b849ea7463b88343e5277b373d0c4ea9`, `handy-computer/whisper-large-v3-gguf` @ `274ad1d1cf680b7ee53cc70f78461394cd3a344b`, `handy-computer/whisper-large-v3-turbo-gguf` @ `18ada752005f5fddef499256f9a458d0b37a203a`. SHA-256 values are in `server-setup.md`.
- Targets: the default model keeps `STT_MODEL_PATH`, Whisper Large v3 keeps `STT_WHISPER_MODEL_PATH` (already provisioned on the live server, id and path unchanged), every other entry lives in `STT_MODELS_DIR` (default `/models`) under its file name. Duplicate targets are refused at startup.
- Families are strategies (`model-jobs.ts`): `parakeet` uses `RoutedJobs` (its own verbatim worker inside the shared Canary + language ID routing, exactly like the default), `whisper` uses `DirectJobs` (bypasses routing). Canary and the language ID stay admin-provisioned infrastructure, not catalog entries.
- `stt-provision` is unchanged in scope: default model, the two language models and Whisper Large v3. The extra catalog entries are only downloaded on request. Provisioning still writes `<target>.download`; sidecar downloads write `<target>.partial`, so a provisioning run and the sidecar never delete each other's temp files.
- Downloads run inside the sidecar (`ModelDownloads`), reusing the provisioning downloader, now `downloadVerified` (`verified-download.ts`): stream into the temp file in the target directory, abort as soon as more bytes than the pinned size arrive, check the exact size and SHA-256, flush the file (`flush: true`), rename atomically, fsync the directory. The temp file is deleted on failure and cancel; `removePartials` deletes leftovers at startup. Provisioning gained the size check and the fsyncs too.
- One download at a time server-wide. A second id is refused (`download_busy`); repeating the running id answers `started`. Before a download the sidecar checks `statfs` of the target directory: free space must be at least size + 1 GiB (`DOWNLOAD_SPACE_MARGIN_BYTES`), else `insufficient_space`. The check sits behind `DiskSpace` so tests inject the free space. The reservation and its `done` promise cover the whole lifecycle (space check, download, cleanup); the abort signal is checked again after the space check, so a cancel during the check answers `cancelled` only once the reservation is released, and the next download request starts a fresh attempt (the original download request still answers `started`).
- Kill switch `STT_MODEL_DOWNLOADS=enabled|disabled` (default `enabled`). `disabled` refuses download and remove (removing would otherwise strand a device that cannot download again); cancel and the catalog still answer.
- Dynamic availability: `ModelInventory` holds the installed alternatives, seeded from file presence at startup. A finished download marks the model installed (no restart); a removal marks it missing before anything else, so no new request can pick it up.
- Remove: refuses the default (`model_not_removable`), a model being downloaded (`download_busy`) and a model in use (`model_in_use`): a transcription holds a lease via `TranscriptionModel.use` from the moment `/transcribe` picks the model, and a preparation holds one for its whole duration, including the wait for an eviction. Then a per-model removal lock (`ManagedModel.beginRemoval`/`endRemoval`) is held through marking the model missing, unloading its worker (`LoadableTranscriber.unload`, a fresh worker is created on the next load), deleting the file (`ModelFileStore`) and reconciling the inventory (a failed delete restores `installed` when the file is still there). While the lock is held the model is unavailable, a preparation is refused, and a download of that model answers `model_in_use`. The catalog reports such a model as `missing` (no new wire state).
- Residency: the default model is always resident. `ResidencyLimit` keeps at most `STT_MAX_RESIDENT_MODELS` (1 to 8, default 2) alternatives resident or loading. Before an alternative loads, the least recently used idle resident one is unloaded; a model that is transcribing or loading is never unloaded. A preparation counts as occupying a slot from its first synchronous step, so concurrent preparations cannot both see free capacity. When every other resident model is busy the load goes ahead and the limit is restored as soon as the preparation completes (`trim`, sparing the model just loaded) and again after every transcription.
- A failed background download is reported as `state: "failed"` in the catalog (until the next attempt or restart), so the desktop can tell it from a cancel. This is the only addition to the state set of the brief.
- Authorization: `Device.manageModels` in `apps/server/src/devices`. `devices.json` stays `version: 1`; the field is written only as `"manageModels": true`, a missing field means not allowed, so files of older servers read unchanged and a never-granted device is stored byte for byte as before. The gateway checks the permission on every operation (`DeviceModelPermissions`, fresh registry read, fails closed), so a grant or revoke applies to open connections at once. Choosing a model stays open to every paired device.
- Refusals travel in the operation reply (`outcome`), not as `error` messages: every request gets exactly one reply that names its id and operation, nothing closes the connection, and `ERROR_CODES` and the close codes stay as they are.
- The gateway fetches `GET /catalog` on demand (single flight across sessions, 1 s timeout) and refreshes the capability cache in the same request, so `transcriptionModels.available` in the same reply and the model check of the next `start` follow a finished download or a removal. After every operation the cache is refreshed again.

## Wire contract

### STT sidecar (internal HTTP)

Env: `STT_MODELS_DIR` (default `/models`), `STT_MODEL_DOWNLOADS` (`enabled` | `disabled`), `STT_MAX_RESIDENT_MODELS` (default `2`).

- `GET /catalog`

  ```json
  {"downloadsEnabled":true,"models":[
    {"id":"parakeet-ultra","name":"Parakeet Ultra (F16)","family":"parakeet","sizeBytes":1256724448,"removable":false,"state":"installed","receivedBytes":null},
    {"id":"whisper-large-v3-turbo","name":"Whisper Large v3 Turbo (F16)","family":"whisper","sizeBytes":1625935488,"removable":true,"state":"downloading","receivedBytes":402653184}]}
  ```

  `state` is `installed` | `missing` | `downloading` | `failed`; `receivedBytes` is a number only while `downloading`, otherwise `null`. Catalog order is fixed (default first).
- `POST /models/<id>/download`: `202 {"status":"started"}` (also for the id that is already downloading), `200 {"status":"installed"}` (file present, nothing to do; always for the default), `400 {"error":"unknown model"}`, `403 {"error":"downloads disabled"}`, `409 {"error":"download busy"}`, `409 {"error":"model in use"}` (that model is being removed), `507 {"error":"insufficient space"}`.
- `POST /models/<id>/cancel`: `200 {"status":"cancelled"}` (download stopped, partial deleted; answers after the cleanup), `200 {"status":"idle"}` (nothing running for that id), `400 {"error":"unknown model"}`.
- `DELETE /models/<id>`: `200 {"status":"removed"}`, `200 {"status":"missing"}` (not installed), `400 {"error":"unknown model"}`, `403 {"error":"downloads disabled"}`, `409 {"error":"model not removable"}`, `409 {"error":"model in use"}`, `409 {"error":"download busy"}`.
- Any other failure: `500 {"error":"internal error"}`. An id outside the id rule or a wrong method: `404`.
- `GET /capabilities` keeps its shape; `transcriptionModels` now lists all six catalog models, `available` = installed.

### Protocol (`cw1`, additive)

Gate: `MODEL_CATALOG_MIN_VERSION = '0.6.0'`, server version bumped to 0.6.0. Decoding stays strict, so a client sends every new key and message only to servers `>= 0.6.0`; an older server answers `bad_message` and closes.

- Client `capabilities` gains `modelCatalog?: boolean`. Only `true` adds the catalog to the reply; it combines freely with `transcriptionModels: true`.
- Server `capabilities` gains `modelCatalog?: ModelCatalog`, present only when requested:

  ```ts
  type ModelCatalog = { canManage: boolean; downloadsEnabled: boolean; models: CatalogEntry[] };
  type CatalogEntry = {
    id: string;                                   // transcription model id rule
    name: string;                                 // model name rule
    family: 'parakeet' | 'whisper';
    sizeBytes: number;                            // safe non-negative integer
    removable: boolean;
    state: 'installed' | 'missing' | 'downloading' | 'failed';
    receivedBytes: number | null;                 // number exactly when state is downloading
  };
  ```

  At most 8 entries, unique ids, exact keys. `canManage` is the device permission. `downloadsEnabled: false` with `models: []` means the sidecar predates downloads or is unreachable. The shape of `transcriptionModels` entries is unchanged. Progress: re-send `{type:'capabilities', modelCatalog:true}` while an entry is `downloading` (the gateway asks the sidecar every time).
- New client messages, allowed only while the session is idle (otherwise `bad_message` and close, like `capabilities`): `{type:'model-download', id}`, `{type:'model-remove', id}`, `{type:'model-download-cancel', id}`.
- New server message, exactly one per command: `{type:'model-operation', id, operation: 'download' | 'remove' | 'cancel', outcome}`.

  | `outcome` | Meaning |
  |---|---|
  | `started` | download running (poll the catalog) |
  | `installed` | download: file already present |
  | `removed` | remove: file deleted, model unavailable |
  | `missing` | remove: model was not installed |
  | `cancelled` | cancel: download stopped, partial deleted |
  | `idle` | cancel: nothing was downloading for that id |
  | `forbidden` | device lacks the `manageModels` grant |
  | `downloads_disabled` | kill switch `STT_MODEL_DOWNLOADS=disabled` |
  | `download_busy` | another download runs, or remove of the model being downloaded |
  | `insufficient_space` | free space below size + 1 GiB |
  | `model_in_use` | remove while the model transcribes or loads, or download while it is being removed |
  | `model_not_removable` | remove of the default model |
  | `unknown_model` | id not in the catalog |
  | `stt_unavailable` | sidecar unreachable, too old, or failed |

- `ERROR_CODES` and close codes are unchanged.

| Pair | Behaviour |
|---|---|
| Old client, new server | Never sends `modelCatalog` or the model commands; old reply shapes. |
| New client, old server (< 0.6.0) | Gate closed: no catalog UI, no commands. |
| New client, new server, old stt | `modelCatalog` with `downloadsEnabled: false, models: []`; commands answer `stt_unavailable`. |
| New client, new server, new stt | Full feature. |

### Admin

- Admin socket: `{"cmd":"manage-models","deviceId":"<8 hex>","allowed":true|false}` answers `{"found":boolean,"manageModels":boolean}`. `{"cmd":"devices"}` entries gain `manageModels`.
- CLI: `codevo-whisper grant-models <deviceId>` and `codevo-whisper revoke-models <deviceId>` (exit 0, `1` for an unknown device, `2` without an id). `devices` prints `správa modelov: povolená|nepovolená`.
- Desktop grant command, built like `revokeCommand` in `apps/desktop/src/shared/server.ts`: Linux native `codevo-whisper-server grant-models <deviceId>`, otherwise `docker compose -f infrastructure/compose/compose.yaml exec gateway codevo-whisper grant-models <deviceId>`. Show it when `modelCatalog.canManage` is `false`.

## Steps

1. Protocol: `model-catalog.ts` (types, validators), `capabilities.modelCatalog` both ways, the three commands, `model-operation`, `MODEL_CATALOG_MIN_VERSION`. Tests: round trips, strict validation, legacy-decoder documentation, unchanged error codes.
2. stt: pinned files and catalog, config, `ModelInventory`, `LoadableTranscriber`, `OnDemandTranscriptionModel`, `ResidencyLimit`, `ModelJobs` strategies, `downloadVerified`, `ModelDownloads`, `DiskSpace`, `ModelManagement`, `ModelRoutes`, `main.ts` startup (presence check, partial cleanup, log). Tests with the fake worker and a local model host server (no network).
3. Gateway: `Device.manageModels`, `findById`, `allowModelManagement`, admin `manage-models`, CLI `grant-models` and `revoke-models`, `HttpSttModelManagement`, `ModelCatalogService`, session handler, version 0.6.0. Tests through the real gateway, admin CLI and the fake stt (`FakeModelCatalog`).
4. Compose: models volume writable for `stt` only (hardening unchanged), new env; Dockerfile env; `server-setup.md`.
5. `pnpm lint`, `pnpm typecheck`, `pnpm test`.

## Known limits

- `routesDictationLanguages` is unchanged: only the default model is checked against `capabilities.languages`. `parakeet-ultra-q8` with dictation languages is not pre-checked by the gateway or the desktop; when Canary or the language ID is missing the sidecar refuses it with `languages unavailable` and the gateway reports `languages_unavailable`.
- Two F16 alternatives resident next to Parakeet, Canary and the language ID can exceed `STT_MEM_LIMIT=8g`; the docs recommend `STT_MAX_RESIDENT_MODELS=1` or a higher limit.
- The native install script does not set `STT_MODELS_DIR` or `STT_WHISPER_MODEL_PATH`; native downloads need them added by hand (documented).
- A file added to the volume outside the sidecar (provisioning) is noticed only at the next sidecar start.
- Real Hugging Face downloads, GPU loads of the new files and real disk-full behaviour are not covered by the automated tests.
