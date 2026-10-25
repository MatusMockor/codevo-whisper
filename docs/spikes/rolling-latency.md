# Spike: rolling re-transcription latency on the home server

Date: 2026-10-25. Plan: `docs/plans/2026-10-25-phase-0-spikes.md` Task 5. Spec: section 6.

## Setup

- Engine: aivora sidecar `aivora-validation-stt-1` (`aivora-stt-parakeet:ultra-f16`, Vulkan, RX 7800 XT) at `127.0.0.1:8001`, reached from the Mac through `ssh -L 18001:127.0.0.1:8001 -L 18002:127.0.0.1:8002 codex@192.168.1.110`. Read-only use; nothing on the server was restarted or changed.
- Test audio: a 4-paragraph Slovak dictation (a developer describing a pull request), synthesized by the aivora TTS (`/synthesize` returns PCM16 LE mono 24 kHz) in 4 calls, concatenated and resampled with `ffmpeg -ar 16000 -ac 1 -f s16le`. Result: 70.0 s, 2,240,260 bytes. Stored in `spikes/rolling-latency/.data/` (gitignored).
- Speech character: fluent, no long pauses. Sentence pauses are only 150-290 ms (energy RMS < 500 on 10 ms subframes); there is no pause >= 300 ms in the whole 70 s.
- Script: `spikes/rolling-latency/measure.ts` (`node measure.ts ...`, Node 24 type stripping). Streams audio in real time as 100 ms frames, energy VAD on 10 ms subframes, policy from spec 6:
  - partial = re-transcribe the uncommitted tail every interval (skipped if this device already has a partial pending or in flight);
  - commit when tail >= target and the trailing silence >= min pause (cut in the middle of the pause);
  - hard cut at the hard limit with 1 s overlap, word dedup across the boundary;
  - end of speech (last frame) = final for the remaining tail.
- Two schedulers:
  - `shared`: one engine worker for all devices, finals first (FIFO), partials round-robin per device, one pending partial per device. This is what the gateway should do.
  - `direct`: every device calls the sidecar on its own; a partial that gets `503` is dropped, a final is retried every 25 ms.
- Policy for all runs below unless noted: target 15 s, hard 25 s, overlap 1 s, VAD threshold RMS 500, min pause 200 ms.
- Sessions for end-of-speech numbers: 10 sessions per device of 4, 7, 10, 13, 16, 19, 22, 28, 35 and 45 s cut from different offsets of the test audio (20 samples per two-device run).

## 1. Engine service time vs tail length (idle engine, sequential, 10 reps)

| tail s | p50 ms | p95 ms | max ms |
|---|---|---|---|
| 1 | 401 | 477 | 477 |
| 2 | 413 | 517 | 517 |
| 3 | 444 | 549 | 549 |
| 5 | 445 | 516 | 516 |
| 7.5 | 498 | 599 | 599 |
| 10 | 500 | 527 | 527 |
| 12.5 | 508 | 558 | 558 |
| 15 | 503 | 524 | 524 |
| 17.5 | 515 | 568 | 568 |
| 20 | 524 | 566 | 566 |
| 22.5 | 557 | 700 | 700 |
| 25 | 560 | 629 | 629 |
| 30 | 612 | 685 | 685 |

The cost is almost flat: about 400 ms fixed per call plus about 7 ms per second of audio. Measured on the server itself (no tunnel) a 5 s call takes 436 ms; the SSH tunnel adds 30-70 ms.

**Cause of the fixed cost:** the aivora sidecar spawns a new `transcribe-cli --model /models/parakeet-ultra-F16.gguf --backend vulkan ...` process per request (seen in `docker top` during calls), so every call pays process start, model load and Vulkan init. The actual inference is about 0.007 x real time. The "6.7 s in 0.4 s" figure in spec 6 is mostly this overhead.

## 2. One device

Engine service time and partial latency (tick -> partial text visible) inside the rolling simulation, interval 1 s, the 10-session run (210 calls):

| tail s | n | service p50 | service p95 | partial visible p50 | partial visible p95 |
|---|---|---|---|---|---|
| <=2.5 | 29 | 464 | 605 | 473 | 605 |
| 5 | 70 | 520 | 653 | 520 | 653 |
| 10 | 50 | 524 | 616 | 524 | 616 |
| 15 | 36 | 528 | 629 | 531 | 629 |
| 20 | 17 | 580 | 583 | 580 | 584 |
| 25 | 8 | 575 | 628 | 587 | 628 |

The 70 s run alone gives the same picture: partial p50 463-616 ms, p95 554-887 ms per bucket.

| scenario | 503s | partial refresh gap p50/p95 ms | end-of-speech -> final p50/p95/max ms (n=10) |
|---|---|---|---|
| interval 1 s | 0 | 1003 / 1088 | 968 / 1105 / 1105 |
| interval 2 s | 0 | 2002 / 2099 | 525 / 1063 / 1063 |

End-of-speech -> final is bimodal: about 520 ms when the engine is idle at key-up, about 1000-1100 ms when a partial of the same device is still in flight (calls cannot be pre-empted, the final waits behind it). With a 1 s interval and ~0.55 s service the engine is busy ~55 % of the time, so about half of the key-ups land on a busy engine. A 2 s interval halves that probability (better p50) but not the worst case (p95 stays ~1.1 s).

## 3. Two devices on one engine

| scenario | 503s | partials dropped | partial visible p50 / p95 / max ms | refresh gap p50/p95 ms | final commit -> text p95 ms | end-of-speech -> final p50/p95/max ms (n=20) |
|---|---|---|---|---|---|---|
| shared, interval 1 s | 0 | 29 of 383 ticks (in flight) | 520-830 / 1022-1650 / 1650 | 1048 / 1618 | 946-1053 | 602 / 997 / 1054 |
| shared, interval 2 s | 0 | 0 | 520-630 / 695-778 / 1039 | 2020 / 2170 | 908-1120 | 562 / 1091 / 1120 |
| direct, interval 1 s | 194 | 175 (503) | 510-590 / 589-754 / 754 | 1033 / 5940 | 587-1009 | 542 / 964 / 1009 |

Per-bucket partial latency, shared, interval 1 s vs 2 s (p50 / p95 ms):

| tail s | 1 s | 2 s |
|---|---|---|
| 5 | 520 / 1030 | 520 / 778 |
| 10 | 720 / 1022 | 529 / 757 |
| 15 | 684 / 1400 | 561 / 695 |
| 20 | 768 / 1232 | 579 / 710 |
| 25 | 832 / 1650 | 632 / 632 |

Three devices, shared, interval 1 s (70 s run, 3 sessions): partial visible p50 893-1959 ms, p95 1437-3325 ms, refresh gap p95 2855 ms, 79 of 207 ticks dropped. Finals stay fine (commit -> text p95 965 ms, end-of-speech -> final max 624 ms) because they have priority.

Observations:

- Two devices at 1 s each ask for ~110 % of the engine. Partials then queue (wait p95 586 ms, max 1044 ms) and refresh slows to p95 1.6 s. At 2 s per device (~55 % load) partial latency is back near the single-device numbers.
- Finals are not hurt by the second device thanks to the priority queue: end-of-speech -> final p95 is ~1.0-1.1 s in every two-device configuration, the same as with one device. The worst case is "one call already in flight" (own or the other device's).
- Direct calls with `503` are unusable as a scheduling mechanism: devices phase-lock and one starves. In the 70 s run device 1 got 6 partials and 63 drops while device 0 got 67; in the session run refresh gap p95 was 5.9 s. A shared fair queue in the gateway is required.

## 4. Commit policy and accuracy

- With min pause 300 ms the fluent TTS speech never produced a pause commit: the 70 s run was 2 hard cuts + end. With 200 ms: 1 hard cut, 1 pause commit, end. Real dictation usually has longer pauses, so TTS is the pessimistic case, but 300 ms is too strict for fluent speakers.
- WER vs the source text (normalised, numerals count as errors, so the absolute value is dominated by TTS/ASR mismatches like "pôl request", "15" vs "pätnásť"): single-shot per paragraph 18.1 %, rolling with 300 ms pause 18.7 %, rolling with 200 ms pause 19.3 %. Rolling costs about 1 point, all of it at cut boundaries:
  - hard cut, exact word dedup missed one duplicate because the overlap word was recognised differently on each side ("zahodíme." / "zahodím.");
  - pause commit at a 200 ms comma pause: the first word after the cut was garbled ("priebežné" -> "Pride bežné") because the next segment starts without left context.
- Tail length barely changes cost (5 s -> 25 s is about +100 ms), so short targets do not buy latency on this engine; long tails reduce the number of cuts.

## Recommended defaults for spec 6

| setting | value | why |
|---|---|---|
| partial interval | 1 s with one active device; per-device interval = active devices x 1 s (global budget ~1 partial/s), adaptive upper bound 3 s | keeps engine load from partials at ~55 %; 2 devices at 1 s saturate the engine |
| adaptive rule | interval = clamp(active devices x EWMA(service) / 0.55, 1 s, 3 s) | same thing expressed for slower engines (CPU-only, LocalEngine) |
| target length | 15 s (keep) | cost is flat with length; no gain from shorter |
| hard limit | 25 s (keep) + 1 s overlap = 26 s per call, under the 30 s / 960000-byte sidecar limit | measured fine; margin for frame granularity |
| min pause for commit | 200 ms (not 300 ms), choose the longest pause seen since the target was reached | 300 ms never triggered on fluent speech |
| overlap / dedup | 1 s overlap on hard cuts, fuzzy word dedup (case/punctuation-insensitive plus edit distance <= 2 per word); consider 0.5 s of left context on pause cuts as well | both exact dedup and context-less pause cuts produced boundary errors |
| scheduling | one engine queue in the gateway: finals FIFO first, partials round-robin per device, at most one pending partial per device, never surface 503 to clients | direct 503 handling starves a device |
| throttle partials with 2+ devices | yes | 2 devices at 1 s: partial p95 1.0-1.6 s, 3 devices: up to 3.3 s |

Optional, worth trying in `packages/audio`: skip a partial tick when the last >= 300 ms of the tail is silence (no new words), which lowers the chance that a partial is in flight at key-up and so the bimodal end-of-speech latency.

## Acceptance thresholds for phase 2 (this server, engine of this speed)

- One device: partial visible p95 <= 0.8 s, partial refresh gap p95 <= 1.2 s, end-of-speech -> final p50 <= 1.0 s and p95 <= 1.3 s.
- Two devices: end-of-speech -> final p95 <= 1.3 s per device, partial visible p95 <= 1.0 s, no `503` reaching a client, neither device below 40 % of the partials of the other.
- Measured here (end-of-speech -> final p50 / p95): one device 0.97 / 1.11 s at 1 s interval and 0.53 / 1.06 s at 2 s; two devices (shared) 0.60 / 1.00 s at 1 s and 0.56 / 1.09 s at 2 s. Small n (10-20), so the p50 swings between the two modes (~0.5 s idle, ~1.0 s behind an in-flight call).

## Surprises and follow-ups

- The 400 ms floor is process spawn + model load per request in the aivora sidecar, not inference. The codevo-whisper `stt` container should keep the model resident (persistent transcribe.cpp process or library binding). That needs checking against transcribe.cpp at the pinned commit (Task 4); with a resident model service time could drop to tens of ms and the interval could go below 1 s, but this spike did not measure that.
- Because cost does not grow with tail length, the spec's worry about long tails is not the bottleneck here; the per-call fixed cost and the number of calls are.
- The aivora sidecar runs `--timestamps none`. With word timestamps from our own engine, cut and dedup could work on time instead of text matching.
- Caveats: synthetic TTS speech (clean, no background noise; a fixed energy threshold of 500 will not work on real microphones, the VAD needs an adaptive noise floor), small n for end-of-speech (10 or 20 samples per scenario), measured through an SSH tunnel over LAN (+30-70 ms per call), the GPU was shared with an idle second aivora STT container.

## Reproduce

```bash
ssh -N -L 18001:127.0.0.1:8001 -L 18002:127.0.0.1:8002 codex@192.168.1.110 &
cd spikes/rolling-latency
node measure.ts --mode sweep --reps 10 --label sweep
node measure.ts --label single-i1000-p300 --pause 300
node measure.ts --label single-i1000-p200 --pause 200
node measure.ts --label eos-single-i1000 --pause 200 --sessions 4,7,10,13,16,19,22,28,35,45
node measure.ts --label two-shared-i1000 --pause 200 --clients 2 --offsets 0,2300
node measure.ts --label two-direct-i1000 --pause 200 --clients 2 --offsets 0,2300 --scheduler direct
node measure.ts --label eos-two-shared-i2000 --pause 200 --clients 2 --offsets 0,2300 --sessions 4,7,10,13,16,19,22,28,35,45 --interval 2000
node measure.ts --label three-shared-i1000 --pause 200 --clients 3 --offsets 0,1100,2300
```

The audio and text are expected in `.data/speech16k.pcm` and `.data/text.txt` (see Setup); every run writes raw per-call JSON to `.data/<label>.json`.
