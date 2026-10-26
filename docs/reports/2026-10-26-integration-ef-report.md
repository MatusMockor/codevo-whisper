# Integration of streams E and F on `main`: report

Merge `d17cb9f` (stream F "server live partials, resident STT worker and hardening" on top of stream E "desktop RemoteEngine"). Focused fix directly on `main` (owner decision), no plan file.

## What failed

- `pnpm lint`: `apps/desktop/src/main/remote/remote-dictation.ts:122` unnecessary type assertion. The protocol `start` message now has `partials?: boolean`, so `{ ...start, partials: true }` is already a `ClientMessage`. The `as ClientMessage` was removed.
- Five desktop tests that run `RemoteEngine` against the real in-process gateway with the fake STT server.

## Root cause per test

All five encoded phase-2 gateway behaviour: fixed 25 s chunks of whatever bytes arrived, with no VAD. Their audio was constant-value PCM (`fill(7)`, `fill(5)`, `stampedPcm(3)`). The stream F `RollingSession` runs an adaptive VAD. Constant PCM is not speech: it gave one 10 s segment (`320000` bytes) or no voiced segment at all, so the expected request sizes, failures and texts never happened. No client/server incompatibility in `RemoteEngine` was found.

| Test | Evidence | Category |
|---|---|---|
| `remote-engine` "streams the recording and joins the finals in segment order" | Got `úsek320000` (one 10 s segment) instead of `úsek800000 úsek32000`. Phase 2 split bytes at 25 s. Now a hard cut at 25 s has a 1 s overlap, so the second segment is 2 s (`64000` bytes), not 1 s. | (a) old chunking |
| `remote-engine` "keeps the text recognised before a later segment failed" | Resolved `začiatok`. The fake STT failed only 1 s segments, and none is produced any more. | (a) old chunking |
| `remote-engine` "reports a dictation longer than the server allows" | Got `protocol` instead of `too-long`. The test pushed 601 s at once. The new per-device ingestion limit (180 s burst, 1.25x real time) answers `bad_message "audio rate exceeded"` long before 600 s. A real recording arrives in real time and never reaches that limit. | (a) the test sent faster than real time |
| `remote-retry` "gives up after the second drop and keeps the best text so far" | Only 1 STT request instead of 2 (the same one-segment effect). | (a) old chunking |
| `session-coordinator-server` "keeps the text recognised before the server failed and offers to copy it" | Showed "Nezachytila sa žiadna reč". `stampedPcm(3)` is near-silent DC, so the VAD skipped every segment and no STT call was made. | (a) silent test audio |

I checked these client/server contracts against the new gateway, and they hold:

- **Flow:** the client honours `flow paused` also after `finish`. With 0.2.0 the pause follows the ingestion bucket, which a real-time client never drains.
- **Failed segment:** the empty `final` and then `error` lead to `stt-unavailable` with the text so far.
- **Overlap and held-back word:** the server dedups the overlap before the `final`, so the client's plain space join is correct (now pinned end to end).
- **Segment ids:** they start at 0 and stay far below the client cap of 4095.
- **Session ids:** the client matches them on every message.
- **Retry:** a resend of at most 120 s fits the 180 s burst. A server test already pins "a 2-minute retry burst followed by real-time audio".

## What changed

- `remote-dictation.ts`: the redundant assertion was removed (lint).
- Tests now use the voiced synthetic speech from `apps/server/test/support/speech.ts` (`speech`, `continuousSpeech`), which the server tests already use, and they assert the new behaviour:
  - "joins the finals in segment order without repeating the overlap": 26 s of continuous speech. STT requests are exactly `25 s` and `2 s`. The STT returns overlapping texts (`... prvá časť` / `časť a koniec diktátu`), and the dictation gives `ahoj toto je prvá časť a koniec diktátu` with the overlap word once.
  - "leaves empty finals out of the text": speech with pauses gives two segments (pause cut). The second final is empty, and the text is `prvá veta`. Before, this test passed only by accident, with a single segment.
  - "keeps the text recognised before a later segment failed": the 2 s tail segment fails. `textSoFar` is `toto je začiatok`, including the word held back at the hard cut, which the server releases in the empty final before `error`.
  - "reports a dictation longer than the server allows": the gateway gets an injected manual clock (`ServerOptions.clock`). 601 s of speech is streamed at real time (10 s steps with the clock advanced), and the result is `too-long`.
  - "gives up after the second drop": continuous speech. `textSoFar` is `prvá časť`, because the last word of the hard-cut segment is held back for the next final, which never arrived.
  - `session-coordinator-server`: `dictate()` takes the PCM. The failure case uses 26 s of continuous speech with the 2 s tail failing, and the last transcript is `toto je začiatok` with the copy action.
- `.gitignore`: `.superpowers/` (local scratch dir).

## Verification

- `pnpm lint`: clean.
- `pnpm typecheck`: clean.
- `pnpm test`: 145 files passed and 1 skipped; 1122 tests passed and 1 skipped. The three changed files ran 5 times in a row, 33 of 33 each time.
- Desktop e2e:
  - `server.spec.ts`: 4 of 4 passed.
  - Full suite: 50 of 50 passed (Electron as an accessory app, no focus stealing).
- CodeRabbit (`coderabbit review --agent --base main`, uncommitted changes): 0 findings on the 5 changed files. The first three attempts were rate-limited by the shared free tier.

## Concerns

- **Held-back word lost after a connection drop.** When a connection drops (or the second attempt fails) between a hard cut and the next final, the client's "text so far" lacks the last word of the hard-cut segment. The server holds it back for the next final, and that final never arrives. This is inherent to the held-back-word design, and the client cannot recover it. It is small (one word, only on a failure) and pinned by the retry test.
- **Blast test removed.** `RemoteEngine` has no test that a faster-than-real-time sender gets `protocol`. That behaviour is pinned on the gateway side (`gateway-live.test.ts` "pauses the flow near the limit and rejects audio beyond it").
