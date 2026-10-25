# Research: speech-to-text models for local mode

Date: 2026-10-25. Spec: `docs/specs/2026-10-25-codevo-whisper-design.md` sections 2 and 7. Previous spike: `docs/spikes/transcribe-macos.md`.
Scripts: `spikes/model-research/`. Data, models and raw results: `~/Library/Caches/codevo-whisper-research/` (outside git).
Draft catalog: `docs/research/model-catalog.draft.json`.

## TL;DR

- **One engine is enough.** Every recommended model runs on transcribe.cpp. whisper.cpp brought nothing that transcribe.cpp could not do: transcribe.cpp also runs Whisper GGUFs, at the same warm speed, with lower cold latency (0.42 vs 0.55 s for turbo Q8_0), and it memory-maps the weights instead of copying them. Proposal: drop whisper.cpp from the local-mode bundle (spec section 7) and keep it only as a fallback option. One binary less to build, sign and notarize.
- **Default everywhere: Parakeet Ultra** (Q8_0 on GPU, Q4_K_M on CPU-only machines). It is the best model on English, close to the best on Slovak, and 2-13x faster than everything else. It also **ignores the language hint**, so mixed sk/cs/en dictation never turns into an accidental translation.
- **Canary 1B v2** is the most accurate for Slovak and Czech (published FLEURS sk 6.84 / cs 8.56 vs Parakeet Ultra 7.83 / 11.04). But it needs the correct language for every utterance: with a wrong or missing hint it **silently translates** (English speech with hint `sk` comes out as fluent Slovak). Offer it as an opt-in model that requires a fixed dictation language.
- **Whisper Large v3 Turbo** is the only option for languages outside the 25 European ones. Whisper large-v3 (in the spec today) and the small/base Whisper models are not worth shipping. small and base reach 35-68 % WER on Slovak and Czech, so they are unusable as the "weak machine" option. Parakeet Ultra Q4_K_M (486 MB) takes that role.

## Recommended catalog

Warm latency is the median for one FLEURS utterance (median length 12.2 s sk, 9.5 s en) on an Apple M5 Pro with Metal, with the model already loaded. WER is measured on our 30-utterance sets; published full-test-set FLEURS numbers are in brackets.

| Catalog entry | Role (settings label) | Size | WER sk | WER cs | WER en | Warm / cold (s) | Language hint |
|---|---|---:|---:|---:|---:|---:|---|
| Parakeet Ultra Q8_0 | Odporúčaný, Najrýchlejší, Najpresnejší pre angličtinu | 740 MB | 6.2 (7.83) | 12.8 (11.04) | 3.7 (4.26) | 0.064 / 0.150 | ignored |
| Canary 1B v2 Q8_0 | Najpresnejší pre slovenčinu a češtinu | 1,144 MB | 5.9 (6.84) | 10.4 (8.56) | 5.3 (4.47) | 0.142 / 0.221 | **required, must be correct** |
| Parakeet Ultra Q4_K_M | Pre slabší počítač | 486 MB | 5.7 (n/a) | 14.7 (n/a) | 3.7 (n/a) | 0.065 / 0.146 | ignored |
| Whisper Large v3 Turbo Q8_0 (transcribe.cpp GGUF) | Pre ďalšie jazyky (99) | 886 MB | 8.6 (10.21) | 13.5 (11.81) | 5.5 (4.38) | 0.324 / 0.421 | leave on auto |

Published numbers are from the transcribe.cpp catalog at the pinned commit (full FLEURS test split, 792 sk / 723 cs / 647 en utterances, Q8_0, measured with the GGUF port) [T1]. The Parakeet Ultra Q4_K_M FLEURS numbers are not published. On LibriSpeech test-clean, Q4_K_M and F16 are within 0.02 pp for every family [T1], and on our sets the differences are inside the confidence interval.

### Default per platform

| Platform | Default | Backend | Evidence |
|---|---|---|---|
| macOS arm64 | Parakeet Ultra Q8_0 | metal | measured: 0.064 s warm / 0.150 s cold per utterance, about 180x real time |
| macOS x64 (Intel) | Parakeet Ultra Q4_K_M | cpu | measured under Rosetta only: 4.8x real time (Q8_0: 3.1x). Real Intel hardware is unverified |
| Linux x64/arm64, CPU only | Parakeet Ultra Q4_K_M | cpu | published, Ryzen 7 4750U CPU: 11-14x real time [T1]. Measured on M5 Pro CPU (4 threads, arm64 proxy): Q8_0 27x |
| Linux with Vulkan | Parakeet Ultra Q8_0 | vulkan | published, Ryzen 4750U iGPU Vulkan: 21-23x real time [T1] |

The same model family on every platform keeps behavior consistent (punctuation, casing, numerals, no language setting). Only the quantization changes. The rule is simple: GPU backend means Q8_0, CPU-only means Q4_K_M. Q4_K_M is the fastest variant measured on the x86 build and is 34 % smaller, with no measurable accuracy loss. On native Ryzen, Q8_0 and Q4_K_M run at the same speed [T1], so the choice there is about download size and RAM. Re-check on a real Intel Mac before release.

## Engines and supported model families (Part A.1)

**transcribe.cpp** @ `8facde6fcd8fb9caa585a5788ab450df6e8ec7db` (MIT [E1]). 20 transcription families and 60+ variants, catalogued in `catalog/*.json` with license, languages, per-quant files and sizes, accuracy and speed benchmarks [T1]. The families that officially cover Slovak and Czech:

| Variant | sk | cs | en | License | Published FLEURS WER sk / cs / en (Q8_0) |
|---|:-:|:-:|:-:|---|---|
| canary-1b-v2 | yes | yes | yes | CC-BY-4.0 | 6.84 / 8.56 / 4.47 |
| parakeet-ultra (Moondream, post-trained from parakeet-tdt-0.6b-v3) | yes | yes | yes | CC-BY-4.0 | 7.83 / 11.04 / 4.26 |
| orukeet (Oruk AI, parakeet-tdt-0.6b-v3 fine-tune) | yes | yes | yes | CC-BY-SA-4.0 | 8.99 / 10.22 / 4.43 |
| whisper-large-v3 | yes | yes | yes | Apache-2.0 on HF, MIT in openai/whisper | 9.25 / 10.50 / 4.03 |
| parakeet-tdt-0.6b-v3 (NVIDIA) | yes | yes | yes | CC-BY-4.0 | 10.19 / 12.31 / 4.83 |
| whisper-large-v3-turbo | yes | yes | yes | MIT | 10.21 / 11.81 / 4.38 |
| parakeet-primeline (German fine-tune) | yes | yes | yes | CC-BY-4.0 | 12.36 / 15.05 / 4.82 |
| whisper-large-v2 | yes | yes | yes | Apache-2.0 / MIT | 12.49 / 14.42 / - |
| whisper-medium | yes | yes | yes | Apache-2.0 / MIT | 18.73 / 22.85 / 4.64 |
| nemotron-3.5-asr-streaming-0.6b | yes | yes | yes | OpenMDW-1.1 | 23.25 / 23.00 / 7.90 |
| whisper-small | yes | yes | yes | Apache-2.0 / MIT | 36.05 / 40.57 / 6.51 |
| fun-asr-mlt-nano-2512 | yes | yes | yes | FunASR model license v1.1 | 60.13 / 48.70 / 5.02 |
| whisper-base / tiny | yes | yes | yes | Apache-2.0 / MIT | 65.77 / 70.14 / 9.88 (base) |
| qwen3-asr-0.6b / 1.7b | no | yes | yes | Apache-2.0 | - / 44.5 (0.6b), 22.97 (1.7b) / - |

No Slovak or Czech: canary-180m-flash, canary-1b-flash, canary-1b (en/de/es/fr only; canary-1b is also CC-BY-NC), cohere-transcribe (14 languages), granite-speech, voxtral (all variants), moonshine, sensevoice, gigaam, the English-only parakeet variants. Auxiliary: `lang-id-voxlingua107-ecapa` (Apache-2.0, 107 languages, 27 MB Q8_0) and `silero-vad-v6.2` (MIT).

**whisper.cpp** v1.9.5 (tag object `d2a764c6`, commit `d1be6fde11ac6e0407606b4e42fe72d34add8037`, MIT [E2]). Runs only the Whisper family. ggml models from `ggerganov/whisper.cpp` @ `5359861c739e955e79d9a303bcbc70fb988958b1` (HF repo license MIT): tiny, base, small, medium (each also `.en`), large-v1, large-v2, large-v3, large-v3-turbo, with q5_0/q5_1/q8_0 quantizations [E3].

**Other engines (noted, not built):**

- *Moondream Photon* is the only runtime for **Parakeet Redux** [M2]: a 1.58-bit Parakeet, 178 MB, published FLEURS sk 7.26 / cs 10.25 / en 4.90, and 113x real time on 8 x86 cores per its card. It would be the ideal Intel/CPU model. However, Photon ships as the Python package `moondream` (PyPI 2.6.1, no license metadata), not as an embeddable native library. Watch for transcribe.cpp support of the ternary format.
- *sherpa-onnx* (Apache-2.0, C/C++ library with Node bindings) runs Parakeet TDT v3 int8 ONNX. It is embeddable and portable, but it is not clearly better than transcribe.cpp, which already has Metal and Vulkan. Moondream's own CPU benchmark puts sherpa-onnx at 42x vs Photon at 113x [M2].
- WhisperKit (CoreML, Swift, macOS only), MLX (Python) and faster-whisper / CTranslate2 (Python first) do not fit the Electron + native sidecar design or the Linux target.

## Candidates: files, sizes, licenses (Part A.3)

All files below were downloaded at the pinned revision and verified against the Hugging Face LFS SHA-256 (`spikes/model-research/download.py`).

| Model id (`models.tsv`) | Repo @ revision | File | Size (B) | SHA-256 |
|---|---|---|---:|---|
| parakeet-ultra-f16 | handy-computer/parakeet-ultra-gguf @ a1539be1b849ea7463b88343e5277b373d0c4ea9 | parakeet-ultra-F16.gguf | 1,256,724,448 | cd97f94fa50a034a9019a47e2ed7a2de3963eed8316d1df4de9efdccca6fe78d |
| parakeet-ultra-q8 | same | parakeet-ultra-Q8_0.gguf | 740,363,168 | 007a59761e9258779f189df396b50d12b83bb5b79e66df4b955c230d2f2a0a59 |
| parakeet-ultra-q4 | same | parakeet-ultra-Q4_K_M.gguf | 486,280,096 | c69b7a5f9071a7afd8a1818ef7ae542c386c4b01ed0cac380c19a99947646bf9 |
| parakeet-tdt-v3-q8 | handy-computer/parakeet-tdt-0.6b-v3-gguf @ d8d8c32cb2017c57e5307767343e97870f8a7f53 | parakeet-tdt-0.6b-v3-Q8_0.gguf | 739,508,576 | 5859f77944efcd8eafa23a6350731960b2b55b2203df51f319665c807d802cc7 |
| canary-1b-v2-q8 | handy-computer/canary-1b-v2-gguf @ 692af661b140183b60e44f55ad03c59e1e77d078 | canary-1b-v2-Q8_0.gguf | 1,144,290,016 | 224f83d1bc487b3303b495a7d6874912fdece93de19d1a04b550829c30a5d289 |
| canary-1b-v2-f16 / -q4 | same | canary-1b-v2-F16.gguf / -Q4_K_M.gguf | 1,966,111,456 / 735,476,448 | see `sha256.tsv` |
| orukeet-q8 | handy-computer/orukeet-gguf @ c5511a3850fce1cbbfa5d94ef815966e1d99275f | orukeet-Q8_0.gguf | 739,508,704 | 68cd64b2a6c3c747... |
| tc-whisper-turbo-q8 | handy-computer/whisper-large-v3-turbo-gguf @ 18ada752005f5fddef499256f9a458d0b37a203a | whisper-large-v3-turbo-Q8_0.gguf | 886,381,728 | 257aa7ec9121... (full value in catalog JSON) |
| wc-* (11 files) | ggerganov/whisper.cpp @ 5359861c739e955e79d9a303bcbc70fb988958b1 | ggml-{large-v3, large-v3-q5_0, large-v3-turbo, -turbo-q8_0, -turbo-q5_0, medium, medium-q5_0, small, small-q8_0, base, base-q8_0}.bin | 3,095,033,483 ... 81,768,585 | verified against HF LFS |
| langid-voxlingua107-q8 | handy-computer/lang-id-voxlingua107-ecapa-gguf @ e59f0f3847e77723b7d58447ef9456fa0c7e9436 | lang-id-voxlingua107-ecapa-Q8_0.gguf | 26,693,632 | 063e6cb0af3d53085fc7d68356dfde5ecee2ffa7bc79855f7e4ff930081bfe3a |

Licenses:

| Model | License | Commercial use, redistribution | Attribution required |
|---|---|---|---|
| Parakeet Ultra (all quants) | CC-BY-4.0 [M1] | yes | yes: credit Moondream and NVIDIA, link the license, state the changes (GGUF conversion, quantization) |
| Canary 1B v2 | CC-BY-4.0 [N2] | yes | yes: credit NVIDIA, link the license, state the changes |
| Parakeet TDT 0.6B v3 | CC-BY-4.0 [N1] | yes | yes |
| Orukeet | CC-BY-SA-4.0 [O1] | yes | yes, and ShareAlike for adapted versions (not triggered by download-only use, but a reason to skip it) |
| Whisper (all sizes) | MIT (openai/whisper: "code and model weights are released under the MIT License" [W1]). HF cards say Apache-2.0 for large-v3, MIT for turbo | yes | keep the copyright notice and license text |
| VoxLingua107 ECAPA (LID) | Apache-2.0 | yes | keep LICENSE/NOTICE |
| transcribe.cpp, ggml, miniz, Silero VAD | MIT [E1] | yes | include license texts (in the "O aplikácii" screen) |
| whisper.cpp | MIT [E2] | yes | include license text |
| FLEURS (test data only, not shipped) | CC-BY-4.0 [D1] | - | cite in this doc |

The app downloads the models from Hugging Face on user request, so it does not redistribute them itself. Attribution in "O aplikácii" is still required for anything it bundles (binaries) and is good practice for the models. The exact attribution strings are in the catalog JSON (`attribution`).

## Method (Part B)

- **Machine:** Apple M5 Pro, macOS 26.6.2, the same one as the transcribe.cpp spike. Metal, 4 CPU threads for every engine. Results are per process, one utterance at a time (push-to-talk shape).
- **Engines:** transcribe.cpp arm64 and x86_64 builds from the spike (`spikes/transcribe-macos/build/*`), and whisper.cpp v1.9.5 built with `-DGGML_METAL=ON -DGGML_METAL_EMBED_LIBRARY=ON -DGGML_NATIVE=OFF -DBUILD_SHARED_LIBS=OFF` (default flash attention on). whisper.cpp used greedy decoding (`-bs 1 -bo 1`, temperature 0 with the default fallback), matching transcribe.cpp's Whisper default, so the latency fits push-to-talk.
- **Data:** Google FLEURS test split [D1] @ `70bb2e84b976b7e960aa89f1c648e09c59f894dd`, `sk_sk`, `cs_cz`, `en_us`. For each language: 30 distinct sentences drawn with a fixed seed (20261025, first recording of each sentence), `raw_transcription` as the reference, audio converted from float32 to 16 kHz mono s16 PCM with ffmpeg. 4.0-20.5 s per utterance, 365 s sk / 384 s cs / 305 s en in total, 622 / 573 / 683 reference words. Plus `spikes/transcribe-macos/sample.wav` (Slovak, 6.7 s).
- **Scoring:** NFC, lowercase, every Unicode punctuation or symbol replaced by a space, whitespace collapsed, diacritics kept. Corpus-level WER and CER with jiwer 3.x. 95 % CI by bootstrap over utterances (2,000 resamples). With 30 utterances the CI is wide (±3-5 pp), so **use the published full-set numbers to rank close models**. Our runs confirm the ranking, the behavior and the latency.
- **Warm:** one long-lived process with the model loaded, one warmup utterance discarded, then each utterance timed (transcribe.cpp `--batch --batch-jsonl` timed per output line; whisper.cpp `whisper-server`, time per HTTP request on localhost). This is the latency of a resident sidecar.
- **Cold:** a new process per utterance (exec, model mmap or load, backend init, inference, exit) with the model file in the page cache and Metal shaders already compiled. This is the latency of spawning the CLI per dictation.
- **First run:** the first-ever run of a binary pays Metal pipeline compilation, which happened once per binary in our runs: 3.1 s for transcribe.cpp (first Parakeet run), 4.0 s for whisper.cpp (first base run). After that, a new model costs 0.15-0.7 s on its first run (transcribe.cpp) or 0.2-1.7 s (whisper.cpp). This matches the spike's 2.5-3.6 s finding: do a warmup after install or update.
- **Memory:** `/usr/bin/time -l`, max over runs of "peak memory footprint". transcribe.cpp memory-maps the weights (not counted in the footprint, but resident while transcribing). whisper.cpp copies them, so its footprint includes the weights. Compare *size + footprint* for transcribe.cpp against *footprint* for whisper.cpp.
- **RTF:** sum of warm wall time / sum of audio duration (lower is better; 0.0054 means 185x real time).
- **Auto-detect:** cold run without a language (transcribe.cpp: no `-l`; whisper.cpp: `-l auto`) for one quant per family. "Mismatch" = wrong hint (sk/cs audio with `en`, en audio with `sk`); "neighbor" = sk audio with `cs` and vice versa.

## Results: Apple Silicon, Metal

Model ids: `wc-*` = whisper.cpp ggml, `tc-*` = Whisper GGUF on transcribe.cpp, everything else = transcribe.cpp. Sorted by WER. "Auto-detect" lists the languages the engine reported (Parakeet and Canary do not report one).

### Slovak (FLEURS sk_sk, 30 utterances)

| Model | Engine | Size | WER % [95% CI] | CER % | Warm median / p95 (s) | Cold median / p95 (s) | RTF warm | Peak footprint | Auto-detect WER % |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| canary-1b-v2-f16 | transcribe.cpp | 1,966 MB | 5.4 [2.7-8.2] | 1.8 | 0.155 / 0.235 | 0.270 / 0.349 | 0.0134 | 204 MB | - |
| canary-1b-v2-q4 | transcribe.cpp | 735 MB | 5.7 [2.9-8.8] | 1.6 | 0.122 / 0.184 | 0.202 / 0.270 | 0.0107 | 203 MB | - |
| parakeet-ultra-q4 | transcribe.cpp | 486 MB | 5.7 [3.5-8.1] | 1.2 | 0.065 / 0.093 | 0.146 / 0.175 | 0.0054 | 276 MB | - |
| canary-1b-v2-q8 | transcribe.cpp | 1,144 MB | 5.9 [2.7-9.3] | 2.2 | 0.142 / 0.198 | 0.221 / 0.290 | 0.0117 | 204 MB | 113.9 |
| parakeet-ultra-f16 | transcribe.cpp | 1,257 MB | 6.2 [3.9-8.7] | 1.4 | 0.066 / 0.095 | 0.154 / 0.182 | 0.0058 | 276 MB | 6.2 |
| parakeet-ultra-q8 | transcribe.cpp | 740 MB | 6.2 [3.9-8.7] | 1.4 | 0.064 / 0.092 | 0.150 / 0.176 | 0.0054 | 277 MB | - |
| wc-large-v3 | whisper.cpp | 3,095 MB | 7.5 [5.2-10.1] | 1.7 | 0.827 / 1.156 | 1.614 / 1.897 | 0.0679 | 3,736 MB | 7.5 (sk) |
| orukeet-q8 | transcribe.cpp | 740 MB | 8.0 [4.3-11.6] | 3.9 | 0.069 / 0.097 | 0.158 / 0.184 | 0.0057 | 278 MB | 8.0 |
| wc-large-v3-q5 | whisper.cpp | 1,081 MB | 8.4 [5.7-11.4] | 1.9 | 0.601 / 0.801 | 0.961 / 1.154 | 0.0496 | 1,640 MB | - |
| wc-turbo-q8 | whisper.cpp | 874 MB | 8.4 [5.5-11.3] | 2.0 | 0.295 / 0.360 | 0.549 / 0.594 | 0.0244 | 1,165 MB | - |
| tc-whisper-turbo-q8 | transcribe.cpp | 886 MB | 8.6 [5.5-11.6] | 2.0 | 0.324 / 0.365 | 0.421 / 0.470 | 0.0267 | 196 MB | 8.6 (sk) |
| wc-turbo | whisper.cpp | 1,625 MB | 8.8 [5.6-11.7] | 2.1 | 0.302 / 0.380 | 0.762 / 0.817 | 0.0251 | 1,967 MB | 8.4 (sk) |
| wc-turbo-q5 | whisper.cpp | 574 MB | 8.9 [5.9-11.9] | 2.1 | 0.347 / 0.401 | 0.500 / 0.548 | 0.0281 | 838 MB | - |
| parakeet-tdt-v3-q8 | transcribe.cpp | 740 MB | 9.1 [5.9-12.7] | 2.1 | 0.069 / 0.095 | 0.156 / 0.186 | 0.0057 | 278 MB | 9.1 |
| wc-medium-q5 | whisper.cpp | 539 MB | 16.2 [12.9-19.9] | 4.2 | 0.386 / 0.512 | 0.596 / 0.715 | 0.0318 | 940 MB | 15.9 (sk) |
| wc-medium | whisper.cpp | 1,534 MB | 16.6 [13.4-20.2] | 4.3 | 0.476 / 0.662 | 0.923 / 1.073 | 0.0394 | 2,003 MB | - |
| wc-small-q8 | whisper.cpp | 264 MB | 35.0 [31.1-39.5] | 9.1 | 0.168 / 0.241 | 0.317 / 0.373 | 0.0144 | 534 MB | - |
| wc-small | whisper.cpp | 488 MB | 35.4 [31.4-39.8] | 9.1 | 0.194 / 0.278 | 0.390 / 0.465 | 0.0164 | 794 MB | 35.7 (cs,sk) |
| wc-base-q8 | whisper.cpp | 82 MB | 67.2 [62.1-72.3] | 20.5 | 0.088 / 0.142 | 0.183 / 0.248 | 0.0076 | 304 MB | - |
| wc-base | whisper.cpp | 148 MB | 68.0 [62.6-73.2] | 20.5 | 0.099 / 0.158 | 0.219 / 0.287 | 0.0087 | 394 MB | 71.7 (cs,hr,ru,sk) |

### Czech (FLEURS cs_cz, 30 utterances)

| Model | Engine | Size | WER % [95% CI] | CER % | Warm median / p95 (s) | Cold median / p95 (s) | RTF warm | Peak footprint | Auto-detect WER % |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| canary-1b-v2-f16 | transcribe.cpp | 1,966 MB | 10.2 [7.0-13.6] | 3.9 | 0.169 / 0.226 | 0.287 / 0.342 | 0.0126 | 209 MB | - |
| canary-1b-v2-q8 | transcribe.cpp | 1,144 MB | 10.4 [7.0-13.9] | 3.9 | 0.148 / 0.198 | 0.237 / 0.288 | 0.0110 | 206 MB | 113.0 |
| wc-large-v3 | whisper.cpp | 3,095 MB | 10.4 [7.0-14.0] | 3.9 | 0.802 / 1.029 | 1.593 / 1.844 | 0.0606 | 3,735 MB | 10.5 (cs) |
| wc-large-v3-q5 | whisper.cpp | 1,081 MB | 10.5 [7.4-14.0] | 4.1 | 0.603 / 0.758 | 0.959 / 1.108 | 0.0459 | 1,640 MB | - |
| canary-1b-v2-q4 | transcribe.cpp | 735 MB | 11.4 [8.1-14.8] | 4.1 | 0.139 / 0.185 | 0.220 / 0.259 | 0.0102 | 205 MB | - |
| orukeet-q8 | transcribe.cpp | 740 MB | 11.6 [7.4-15.8] | 3.9 | 0.075 / 0.095 | 0.161 / 0.189 | 0.0056 | 289 MB | 11.6 |
| parakeet-ultra-f16 | transcribe.cpp | 1,257 MB | 12.6 [7.6-18.5] | 4.2 | 0.070 / 0.093 | 0.160 / 0.188 | 0.0053 | 277 MB | 12.6 |
| parakeet-ultra-q8 | transcribe.cpp | 740 MB | 12.8 [7.8-18.5] | 4.3 | 0.068 / 0.095 | 0.151 / 0.172 | 0.0052 | 284 MB | - |
| tc-whisper-turbo-q8 | transcribe.cpp | 886 MB | 13.5 [10.2-16.8] | 3.9 | 0.325 / 0.357 | 0.424 / 0.450 | 0.0254 | 198 MB | 13.5 (cs) |
| wc-turbo | whisper.cpp | 1,625 MB | 14.0 [10.6-17.4] | 4.2 | 0.294 / 0.335 | 0.751 / 0.806 | 0.0225 | 1,967 MB | 14.3 (cs) |
| wc-turbo-q8 | whisper.cpp | 874 MB | 14.0 [10.6-17.4] | 4.2 | 0.306 / 0.353 | 0.560 / 0.588 | 0.0233 | 1,169 MB | - |
| parakeet-ultra-q4 | transcribe.cpp | 486 MB | 14.7 [9.4-20.8] | 4.7 | 0.069 / 0.092 | 0.145 / 0.173 | 0.0052 | 282 MB | - |
| wc-turbo-q5 | whisper.cpp | 574 MB | 15.0 [11.3-18.7] | 4.4 | 0.314 / 0.353 | 0.499 / 0.525 | 0.0246 | 835 MB | - |
| parakeet-tdt-v3-q8 | transcribe.cpp | 740 MB | 16.1 [10.6-21.7] | 5.0 | 0.076 / 0.095 | 0.159 / 0.177 | 0.0056 | 292 MB | 16.1 |
| wc-medium | whisper.cpp | 1,534 MB | 22.8 [17.8-28.5] | 6.7 | 0.584 / 0.824 | 1.003 / 1.164 | 0.0440 | 2,005 MB | - |
| wc-medium-q5 | whisper.cpp | 539 MB | 24.0 [18.7-30.0] | 6.6 | 0.391 / 0.484 | 0.601 / 0.693 | 0.0294 | 943 MB | 24.2 (cs,sk) |
| wc-small | whisper.cpp | 488 MB | 38.3 [33.4-43.5] | 11.0 | 0.194 / 0.262 | 0.394 / 0.451 | 0.0153 | 793 MB | 38.0 (cs) |
| wc-small-q8 | whisper.cpp | 264 MB | 38.7 [33.6-44.3] | 11.2 | 0.167 / 0.227 | 0.318 / 0.372 | 0.0133 | 532 MB | - |
| wc-base-q8 | whisper.cpp | 82 MB | 68.0 [62.1-74.3] | 20.6 | 0.094 / 0.115 | 0.187 / 0.227 | 0.0072 | 306 MB | - |
| wc-base | whisper.cpp | 148 MB | 68.2 [61.8-74.6] | 20.9 | 0.107 / 0.128 | 0.222 / 0.266 | 0.0081 | 397 MB | 72.9 (cs,cy,pl,sk) |

### English (FLEURS en_us, 30 utterances)

| Model | Engine | Size | WER % [95% CI] | CER % | Warm median / p95 (s) | Cold median / p95 (s) | RTF warm | Peak footprint | Auto-detect WER % |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| parakeet-ultra-q4 | transcribe.cpp | 486 MB | 3.7 [2.0-5.8] | 2.0 | 0.054 / 0.083 | 0.131 / 0.163 | 0.0056 | 272 MB | - |
| parakeet-ultra-q8 | transcribe.cpp | 740 MB | 3.7 [2.1-5.7] | 2.0 | 0.053 / 0.084 | 0.138 / 0.169 | 0.0055 | 271 MB | - |
| parakeet-ultra-f16 | transcribe.cpp | 1,257 MB | 4.0 [2.3-6.2] | 2.0 | 0.058 / 0.091 | 0.145 / 0.177 | 0.0060 | 270 MB | 4.0 |
| parakeet-tdt-v3-q8 | transcribe.cpp | 740 MB | 4.4 [2.5-6.7] | 2.2 | 0.058 / 0.087 | 0.144 / 0.177 | 0.0059 | 280 MB | 4.4 |
| wc-medium | whisper.cpp | 1,534 MB | 5.0 [2.7-7.7] | 2.6 | 0.378 / 0.518 | 0.751 / 0.870 | 0.0376 | 2,008 MB | - |
| canary-1b-v2-q4 | transcribe.cpp | 735 MB | 5.3 [3.1-7.7] | 3.3 | 0.108 / 0.166 | 0.190 / 0.251 | 0.0111 | 199 MB | - |
| canary-1b-v2-q8 | transcribe.cpp | 1,144 MB | 5.3 [3.3-7.5] | 3.3 | 0.119 / 0.185 | 0.201 / 0.275 | 0.0120 | 200 MB | 5.3 |
| canary-1b-v2-f16 | transcribe.cpp | 1,966 MB | 5.5 [3.4-7.7] | 3.4 | 0.131 / 0.214 | 0.250 / 0.324 | 0.0137 | 200 MB | - |
| tc-whisper-turbo-q8 | transcribe.cpp | 886 MB | 5.5 [3.4-7.8] | 2.6 | 0.285 / 0.313 | 0.380 / 0.405 | 0.0283 | 197 MB | 5.5 (en) |
| wc-turbo-q5 | whisper.cpp | 574 MB | 5.5 [3.3-7.9] | 2.6 | 0.266 / 0.303 | 0.436 / 0.467 | 0.0263 | 840 MB | - |
| wc-turbo | whisper.cpp | 1,625 MB | 5.6 [3.5-8.0] | 2.7 | 0.227 / 0.266 | 0.696 / 0.738 | 0.0226 | 1,970 MB | 5.6 (en) |
| wc-turbo-q8 | whisper.cpp | 874 MB | 5.6 [3.5-8.0] | 2.7 | 0.237 / 0.277 | 0.505 / 0.537 | 0.0234 | 1,160 MB | - |
| orukeet-q8 | transcribe.cpp | 740 MB | 5.9 [3.2-9.0] | 4.0 | 0.059 / 0.088 | 0.149 / 0.173 | 0.0060 | 278 MB | 5.9 |
| wc-large-v3 | whisper.cpp | 3,095 MB | 5.9 [3.5-8.8] | 3.7 | 0.477 / 0.675 | 1.294 / 1.452 | 0.0478 | 3,736 MB | 5.9 (en) |
| wc-medium-q5 | whisper.cpp | 539 MB | 5.9 [3.6-8.5] | 2.8 | 0.239 / 0.334 | 0.462 / 0.540 | 0.0243 | 945 MB | 5.6 (en) |
| wc-large-v3-q5 | whisper.cpp | 1,081 MB | 6.0 [3.6-8.9] | 3.7 | 0.394 / 0.529 | 0.748 / 0.861 | 0.0392 | 1,646 MB | - |
| wc-small | whisper.cpp | 488 MB | 6.0 [3.7-8.7] | 2.9 | 0.116 / 0.170 | 0.315 / 0.365 | 0.0117 | 797 MB | 6.2 (en) |
| wc-small-q8 | whisper.cpp | 264 MB | 6.0 [3.7-8.7] | 2.9 | 0.104 / 0.151 | 0.249 / 0.290 | 0.0105 | 536 MB | - |
| wc-base | whisper.cpp | 148 MB | 8.8 [6.0-11.7] | 4.2 | 0.053 / 0.081 | 0.167 / 0.195 | 0.0055 | 391 MB | 8.8 (en) |
| wc-base-q8 | whisper.cpp | 82 MB | 8.8 [6.0-11.7] | 4.2 | 0.047 / 0.071 | 0.143 / 0.172 | 0.0050 | 299 MB | - |

### sample.wav (Slovak, 6.7 s)

Exact match (WER 0, including punctuation and diacritics): Parakeet Ultra F16/Q8_0/Q4_K_M, Canary 1B v2 (all quants), Whisper large-v3 (+q5_0), large-v3-turbo (all quants and both engines). Parakeet TDT v3 and Orukeet: 1 word wrong. Whisper medium 39-44 %, small 33 %, base 67 % WER. Warm / cold: Parakeet Ultra Q8_0 0.051 / 0.133 s, Canary Q8_0 0.113 / 0.199 s, turbo (transcribe.cpp) 0.319 / 0.415 s, large-v3 (whisper.cpp) 0.780 / 1.555 s.

### Language hint behavior (cold, Q8_0, WER %)

| Model | Correct hint sk / cs / en | No hint (auto) sk / cs / en | Wrong hint (sk,cs→`en`; en→`sk`) | Neighbor hint (sk→`cs`, cs→`sk`) |
|---|---|---|---|---|
| Parakeet Ultra | 6.2 / 12.8 / 3.7 | 6.2 / 12.6 / 4.0 (F16) | 6.2 / 12.8 / 3.7 | not needed, hint ignored |
| Canary 1B v2 | 5.9 / 10.4 / 5.3 | **113.9 / 113.0** / 5.3 | **113.9 / 113.0 / 99.3** | **55.3 / 59.6** |
| Whisper turbo (whisper.cpp q8_0) | 8.4 / 14.0 / 5.6 | 8.4 / 14.3 / 5.6 (f16), language detected 90/90 correctly | 101.9 / 111.2 / 21.5 | 26.4 / 30.1 |

WER above 100 % here is not noise. **Canary translates into the hinted language.** With no hint it defaults to English: Slovak speech becomes the English translation ("While working in the hospital, Liggins began studying premature birth in his free time."). With hint `sk`, English speech becomes fluent Slovak, and Czech speech becomes Slovak. Whisper does the same, partially. Parakeet Ultra's output is identical with any hint, because the model has no language conditioning.

**Language ID as a fix for Canary.** VoxLingua107 ECAPA Q8_0 (27 MB) with `--allow sk,cs,en`: 88/90 correct (sk 30/30, en 30/30, cs 28/30; both errors were Czech classified as Slovak), 13-16 ms compute, 0.08 s per cold process. A 2/30 cs→sk error rate means Canary would output a Slovak translation for about 7 % of Czech utterances. That is not acceptable as a silent default, so Canary should only be used with a language the user picked.

## Results: CPU and Intel

Warm / cold median per utterance and real-time speed (sample + FLEURS sk + en; WER matches the Metal runs within ±0.3 pp).

| Platform | Model | sample.wav warm / cold | FLEURS sk warm (median / p95) | Speed | Peak footprint (+ mmapped weights) |
|---|---|---:|---:|---:|---:|
| arm64 CPU (M5 Pro, 4 threads) | Parakeet Ultra Q8_0 | 0.24 / 0.38 s | 0.44 / 0.73 s | 27x RT | 630 MB |
| arm64 CPU | Canary 1B v2 Q4_K_M | 0.51 / 0.67 s | 0.87 / 1.38 s | 13x RT | 857 MB |
| x86_64 under Rosetta, CPU | Parakeet Ultra Q4_K_M | 1.44 / 1.77 s | 2.48 / 3.92 s | 4.8x RT | 615 MB |
| x86_64 under Rosetta, CPU | Parakeet Ultra Q8_0 | 2.18 / 2.50 s | 3.92 / 6.00 s | 3.1x RT | 617 MB |
| x86_64 under Rosetta, CPU | Canary 1B v2 Q4_K_M | 2.22 / 2.58 s | 3.62 / 5.74 s | 3.2x RT | 906 MB |
| x86_64 under Rosetta, CPU (spike) | Parakeet Ultra F16 | 1.78 s cold | - | 3.8x RT | - |

Rosetta translates AVX2 to NEON, so these numbers only show that the x86 code path is correct (identical transcripts) and give a pessimistic order of magnitude. The published native-x86 data for the same builds (Ryzen 7 4750U, 8 cores, Linux) [T1]: Parakeet Ultra Q8_0 CPU 11.5-14.8x RT, Q4_K_M 11.0-14.0x, Vulkan iGPU 21-23x; Canary Q8_0 CPU 7.0-9.4x, Vulkan 14x; Whisper large-v3-turbo Q8_0 CPU 1.1-1.7x (too slow), Vulkan 2.5-3.7x; Whisper large-v3 CPU 0.8-1.1x (slower than real time). **Without a GPU, only the Parakeet family and Canary stay well above real time.** That is the main reason not to default to any Whisper model on Intel or Linux CPU.

## Observations

- The Parakeet family runs at the same speed whatever the quantization (0.064-0.069 s warm on Metal). Q8_0 and Q4_K_M give the same accuracy as F16 (sk 6.2 / 6.2 / 5.7, en 4.0 / 3.7 / 3.7, F16 / Q8_0 / Q4_K_M) at 59 % and 39 % of the size. There is no reason to ship F16 to clients. The server can keep F16.
- Parakeet Ultra beats its base model parakeet-tdt-0.6b-v3 on every language (sk 6.2 vs 9.1, cs 12.8 vs 16.1, en 3.7 vs 4.4), which matches Moondream's card [M1]. Orukeet sits in between, slightly better on Czech (published 10.22 vs 11.04), worse on Slovak (8.99 vs 7.83), with a ShareAlike license. Not worth a catalog slot.
- Whisper large-v3 needs 3.1 GB on disk and 3.7 GB of RAM, and takes 0.8 s warm / 1.6 s cold per utterance, yet it does not beat Canary on Slovak or Czech (ours: sk 7.5 vs 5.9, cs 10.4 vs 10.4; published: 9.25 / 10.50 vs 6.84 / 8.56), at about one sixth of Canary's speed. large-v3-q5_0 (1.08 GB) has the same accuracy at 0.6 s warm. Neither has a role that turbo or Canary does not cover better.
- Turbo runs at about the same warm speed on both engines (0.29-0.32 s). transcribe.cpp is faster cold (0.42 vs 0.55-0.76 s) and uses 196 MB footprint vs 1.2-2.0 GB. Same accuracy (sk 8.6 vs 8.4-8.8).
- Whisper medium got worse on the clean Slovak sample (39-44 % WER) than on FLEURS. Small and base are unusable for Slovak and Czech (35-68 %), though fine for English (6.0 / 8.8). The spec's "one small whisper model for weak machines" would be a trap for the main user group.
- Whisper's own language detection was reliable from medium up (turbo and large-v3 90/90, medium-q5_0 89/90, small 89/90). Base got 78/90 and confused sk/cs with hr/ru/pl/cy. That is slightly better than the 27 MB VoxLingua107 LID (88/90), but it costs a full Whisper pass. Parakeet needs no detection at all.

## Risks and open points

1. **Canary translates instead of transcribing** when the language is wrong or missing. Mitigation: show the Canary entry only together with a required "Jazyk diktovania" setting. Explain that it does not handle mixing languages. Never feed it LID output silently. If automatic language selection is wanted later, run LID and fall back to Parakeet when `p` < 0.9 or the top two are sk/cs.
2. **Intel performance is unverified.** Rosetta gives 3-5x real time. Native AVX2 should be closer to the published Ryzen 11-14x, but a 2-core MacBook Air could be below 2x. Measure on a real Intel Mac before release. If Parakeet Q4_K_M is slow there, nothing else in the catalog is faster.
3. **30-utterance sets are small.** The CIs overlap for close models (Parakeet Ultra vs Canary on Slovak). Published full-set numbers decide the close calls. Q4_K_M FLEURS numbers are not published; run the full FLEURS sk/cs test on the server once before release to confirm Q4_K_M ≈ Q8_0 on low-resource languages.
4. **FLEURS is read Wikipedia speech, 4-20 s.** Real dictation is spontaneous, often 2-5 s, with technical vocabulary and sk/en code-switching. Parakeet has no vocabulary biasing in the CLI (`--vocabulary` is only for models with that feature), Whisper has `--initial-prompt`. Build a small personal test set from real dictation (with consent) before tuning further.
5. **First-run cost.** The Metal shader compile (3-4 s, once per binary identity) and the first load of each newly downloaded model (0.15-0.7 s) should be paid by a warmup after install, update or model download.
6. **Memory:** transcribe.cpp maps weights, so RAM use = model size + 0.2-0.3 GB (Metal) or + 0.6-0.9 GB (CPU). `minRamBytes` in the catalog = size + the largest working set we measured (906 MB), rounded up to 0.5 GiB. All entries fit an 8 GB machine.
7. **Upstream churn.** The handy-computer GGUF repos are young; pin revisions (done in the catalog) and keep mirroring in mind if a repo disappears. The pinned transcribe.cpp commit and the GGUF revisions must stay compatible: check with a model smoke test in CI whenever the engine pin moves.
8. **Not measured:** Linux Vulkan and CPU on real hardware (published numbers only), a truly cold read after reboot, long dictations (> 30 s, Parakeet chunking), noisy audio.

## Proposed spec changes (section 7)

- Bundle transcribe.cpp only. whisper.cpp becomes optional and is not needed for v1.
- Initial catalog: Parakeet Ultra Q8_0, Parakeet Ultra Q4_K_M, Canary 1B v2 Q8_0 (needs a fixed language), Whisper Large v3 Turbo Q8_0 (GGUF on transcribe.cpp). Remove whisper.cpp large-v3 and the small Whisper model.
- Default per platform as in the table above; add a warmup run after install, update and download.
- Add to the catalog schema: `languageHint` (`ignored` / `required` / `optional`), `quantization`, `minRamBytes`, `roles`, and per-platform `defaults`.

## Sources

- [T1] transcribe.cpp model catalog at the pinned commit, e.g. https://github.com/handy-computer/transcribe.cpp/blob/8facde6fcd8fb9caa585a5788ab450df6e8ec7db/catalog/parakeet-ultra.json, `catalog/canary-1b-v2.json`, `catalog/whisper-large-v3-turbo.json`, model docs in `docs/models/`, README family table https://github.com/handy-computer/transcribe.cpp/blob/8facde6fcd8fb9caa585a5788ab450df6e8ec7db/README.md
- [E1] transcribe.cpp LICENSE and THIRD-PARTY-LICENSES.md, https://github.com/handy-computer/transcribe.cpp/blob/8facde6fcd8fb9caa585a5788ab450df6e8ec7db/THIRD-PARTY-LICENSES.md
- [E2] whisper.cpp v1.9.5, https://github.com/ggml-org/whisper.cpp/releases/tag/v1.9.5, LICENSE (MIT)
- [E3] whisper.cpp ggml models, https://huggingface.co/ggerganov/whisper.cpp/tree/5359861c739e955e79d9a303bcbc70fb988958b1
- [M1] Moondream Parakeet Ultra model card (FLEURS per language, license), https://huggingface.co/moondream/parakeet-ultra, GGUF: https://huggingface.co/handy-computer/parakeet-ultra-gguf
- [M2] Moondream Parakeet Redux model card, https://huggingface.co/moondream/parakeet-redux; Photon: https://moondream.ai/photon; https://pypi.org/project/moondream/
- [N1] NVIDIA parakeet-tdt-0.6b-v3 model card (CC-BY-4.0; FLEURS sk 8.82, cs 11.01, en 4.85), https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3
- [N2] NVIDIA canary-1b-v2 model card (CC-BY-4.0; FLEURS sk 5.74, cs 7.86, en 4.50), https://huggingface.co/nvidia/canary-1b-v2
- [O1] Orukeet model card, https://huggingface.co/oruk/orukeet
- [W1] OpenAI Whisper README and LICENSE, https://github.com/openai/whisper#license; https://huggingface.co/openai/whisper-large-v3 (apache-2.0), https://huggingface.co/openai/whisper-large-v3-turbo (mit)
- [D1] Google FLEURS, CC-BY-4.0, https://huggingface.co/datasets/google/fleurs

NVIDIA's self-reported FLEURS numbers [N1, N2] are lower than the transcribe.cpp port's numbers [T1] (for example Canary sk 5.74 vs 6.84). The likely cause is a different text normalizer (the Open ASR Leaderboard normalizer vs plain scoring). Compare within one source, not across sources.

## Reproduce

```bash
cd spikes/model-research
python3 download.py <model ids from models.tsv>
python3 prepare_fleurs.py
./run_arm64.sh <model ids>
./run_extra.sh
~/Library/Caches/codevo-whisper-research/venv/bin/python report.py arm64-metal arm64-cpu x86_64-cpu
python3 tables.py arm64-metal sk
python3 make_catalog.py
```

FLEURS tarballs are downloaded by hand into `data/fleurs-dl/<code>/` (`test.tsv`, `test.tar.gz` from `https://huggingface.co/datasets/google/fleurs/resolve/main/data/<code>/`). The venv needs `jiwer`.
