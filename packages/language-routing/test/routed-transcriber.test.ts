import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LanguageSelection } from '../src/language-selection';
import { SK_GIBSON, UK_DRIFT } from './support/benchmark-texts';
import { closeRig, createRig, pcm, pidOf, startWith, type RoutingRig } from './support/routing-rig';

const SK = LanguageSelection.of(['sk']);
const SK_CS = LanguageSelection.of(['sk', 'cs']);
const SK_EN = LanguageSelection.of(['sk', 'en']);
const TWO_SECONDS = 32_000;

const CONFIDENT_SK = { FAKE_WORKER_LID_TOP: 'sk', FAKE_WORKER_LID_P: '0.995' };
const UNSURE_SK = { FAKE_WORKER_LID_TOP: 'sk', FAKE_WORKER_LID_P: '0.6' };

let rig: RoutingRig;

beforeEach(() => {
  rig = createRig();
});

afterEach(async () => {
  await closeRig(rig);
  vi.unstubAllEnvs();
});

describe('RoutedTranscriber on resident workers', () => {
  it('keeps automatic mode on the verbatim model without language ID', async () => {
    const result = await rig.routed.transcribe({ pcm: pcm(TWO_SECONDS), selection: 'auto', kind: 'final' });

    expect(result).toMatchObject({ route: 'auto', language: null });
    expect(result.text).toMatch(/:auto:32000$/);
    expect(rig.identifier.ready()).toBe(false);
    expect(rig.conditioned.ready()).toBe(false);
  });

  it('keeps segments under 500 ms verbatim without language ID', async () => {
    const result = await rig.routed.transcribe({ pcm: pcm(7_999), selection: SK_CS, kind: 'final' });

    expect(result).toMatchObject({ route: 'verbatim-short', language: null });
    expect(result.text).toMatch(/:auto:7999$/);
    expect(rig.identifier.ready()).toBe(false);
    expect(rig.conditioned.ready()).toBe(false);
  });

  it('identifies a 500 ms segment', async () => {
    await startWith(rig.identifier, { ...CONFIDENT_SK, FAKE_WORKER_LID_MIN_SAMPLES: '8000' });
    await startWith(rig.verbatim, { FAKE_WORKER_REPLY_TEXT: UK_DRIFT });

    const result = await rig.routed.transcribe({ pcm: pcm(8_000), selection: SK_CS, kind: 'final' });

    expect(result).toMatchObject({ route: 'conditioned', language: 'sk' });
  });

  it('keeps confidently foreign speech verbatim', async () => {
    await startWith(rig.identifier, { FAKE_WORKER_LID_TOP: 'uk', FAKE_WORKER_LID_P: '0.995' });

    const result = await rig.routed.transcribe({ pcm: pcm(TWO_SECONDS), selection: SK_CS, kind: 'final' });

    expect(result).toMatchObject({ route: 'verbatim-foreign', language: null });
    expect(result.text).toMatch(/:auto:32000$/);
    expect(rig.conditioned.ready()).toBe(false);
  });

  it('keeps unsure speech verbatim when its spelling fits the selection', async () => {
    await startWith(rig.identifier, UNSURE_SK);

    const result = await rig.routed.transcribe({ pcm: pcm(TWO_SECONDS), selection: SK_CS, kind: 'final' });

    expect(result).toMatchObject({ route: 'verbatim-unsure', language: null });
    expect(result.text).toMatch(/:auto:32000$/);
    expect(rig.conditioned.ready()).toBe(false);
  });

  it('fixes unsure verbatim text in a foreign script with the conditioned model', async () => {
    await startWith(rig.identifier, UNSURE_SK);
    await startWith(rig.verbatim, { FAKE_WORKER_REPLY_TEXT: UK_DRIFT });

    const result = await rig.routed.transcribe({ pcm: pcm(TWO_SECONDS), selection: SK_CS, kind: 'final' });

    expect(result).toMatchObject({ route: 'conditioned-fix', language: 'sk' });
    expect(result.text).toMatch(/:sk:32000$/);
  });

  it('uses the conditioned model when the language is confident and the guard agrees', async () => {
    await startWith(rig.identifier, CONFIDENT_SK);
    await startWith(rig.conditioned, { FAKE_WORKER_REPLY_TEXT: SK_GIBSON.canarySk });
    await startWith(rig.verbatim, { FAKE_WORKER_REPLY_TEXT: SK_GIBSON.parakeet });

    const result = await rig.routed.transcribe({ pcm: pcm(TWO_SECONDS), selection: SK_CS, kind: 'final' });

    expect(result).toEqual({ text: SK_GIBSON.canarySk, language: 'sk', route: 'conditioned' });
  });

  it('treats a single selected language as confident', async () => {
    await startWith(rig.identifier, { FAKE_WORKER_LID_TOP: 'sk', FAKE_WORKER_LID_P: '0.3' });
    await startWith(rig.verbatim, { FAKE_WORKER_REPLY_TEXT: UK_DRIFT });

    const result = await rig.routed.transcribe({ pcm: pcm(TWO_SECONDS), selection: SK, kind: 'final' });

    expect(result).toMatchObject({ route: 'conditioned', language: 'sk' });
  });

  it('keeps the verbatim text when the guard sees a translation', async () => {
    await startWith(rig.identifier, { FAKE_WORKER_LID_TOP: 'en', FAKE_WORKER_LID_P: '0.995' });
    await startWith(rig.conditioned, { FAKE_WORKER_REPLY_TEXT: SK_GIBSON.canaryEn });
    await startWith(rig.verbatim, { FAKE_WORKER_REPLY_TEXT: SK_GIBSON.parakeet });

    const result = await rig.routed.transcribe({ pcm: pcm(TWO_SECONDS), selection: SK_EN, kind: 'final' });

    expect(result).toEqual({ text: SK_GIBSON.parakeet, language: null, route: 'verbatim-guard' });
  });

  it('keeps the conditioned text when the verbatim text drifted into Cyrillic', async () => {
    await startWith(rig.identifier, CONFIDENT_SK);
    await startWith(rig.conditioned, { FAKE_WORKER_REPLY_TEXT: SK_GIBSON.canarySk });
    await startWith(rig.verbatim, { FAKE_WORKER_REPLY_TEXT: UK_DRIFT });

    const result = await rig.routed.transcribe({ pcm: pcm(TWO_SECONDS), selection: SK_CS, kind: 'final' });

    expect(result).toEqual({ text: SK_GIBSON.canarySk, language: 'sk', route: 'conditioned' });
  });

  it('runs the conditioned and the verbatim model in parallel', async () => {
    await startWith(rig.identifier, CONFIDENT_SK);
    await startWith(rig.conditioned, { FAKE_WORKER_DELAY_MS: '1000' });
    await startWith(rig.verbatim, { FAKE_WORKER_DELAY_MS: '1000' });
    const started = performance.now();

    await rig.routed.transcribe({ pcm: pcm(TWO_SECONDS), selection: SK_CS, kind: 'final' });

    expect(performance.now() - started).toBeLessThan(1_800);
  });

  it('never mixes the verbatim text of concurrent segments', async () => {
    await startWith(rig.identifier, UNSURE_SK);
    await startWith(rig.verbatim, { FAKE_WORKER_DELAY_MS: '50' });
    const verbatimPid = pidOf(await rig.verbatim.transcribe({ pcm: pcm(1), language: 'auto' }));

    const results = await Promise.all(
      [16_000, 24_000, 32_000, 40_000].map((samples) => rig.routed.transcribe({ pcm: pcm(samples), selection: SK_CS, kind: 'final' })),
    );

    expect(results.map((result) => result.text)).toEqual([16_000, 24_000, 32_000, 40_000].map((samples) => `${verbatimPid}:auto:${samples}`));
  });

  it('never mixes the parallel texts of concurrent confident segments', async () => {
    await startWith(rig.identifier, CONFIDENT_SK);
    await startWith(rig.conditioned, { FAKE_WORKER_DELAY_MS: '30' });
    await startWith(rig.verbatim, { FAKE_WORKER_DELAY_MS: '60', FAKE_WORKER_REPLY_TEXT: UK_DRIFT });
    const conditionedPid = pidOf(await rig.conditioned.transcribe({ pcm: pcm(1), language: 'sk' }));

    const results = await Promise.all([16_000, 24_000, 32_000].map((samples) => rig.routed.transcribe({ pcm: pcm(samples), selection: SK_CS, kind: 'final' })));

    expect(results.map((result) => result.text)).toEqual([16_000, 24_000, 32_000].map((samples) => `${conditionedPid}:sk:${samples}`));
  });

  it('propagates an abort to both parallel models', async () => {
    await startWith(rig.identifier, CONFIDENT_SK);
    await startWith(rig.conditioned, { FAKE_WORKER_SLOW_SAMPLES: String(TWO_SECONDS), FAKE_WORKER_SLOW_MS: '5000' });
    await startWith(rig.verbatim, { FAKE_WORKER_SLOW_SAMPLES: String(TWO_SECONDS), FAKE_WORKER_SLOW_MS: '5000' });
    const conditionedPid = pidOf(await rig.conditioned.transcribe({ pcm: pcm(1), language: 'sk' }));
    const verbatimPid = pidOf(await rig.verbatim.transcribe({ pcm: pcm(1), language: 'auto' }));
    const controller = new AbortController();
    const reason = new DOMException('segment cancelled', 'AbortError');
    setTimeout(() => controller.abort(reason), 400);
    const started = performance.now();

    await expect(rig.routed.transcribe({ pcm: pcm(TWO_SECONDS), selection: SK_CS, kind: 'final', signal: controller.signal })).rejects.toBe(reason);

    expect(performance.now() - started).toBeLessThan(2_000);
    expect(pidOf(await rig.conditioned.transcribe({ pcm: pcm(1), language: 'sk' }))).not.toBe(conditionedPid);
    expect(pidOf(await rig.verbatim.transcribe({ pcm: pcm(1), language: 'auto' }))).not.toBe(verbatimPid);
  });

  it('propagates an abort to language ID and starts no transcription', async () => {
    await startWith(rig.identifier, { ...CONFIDENT_SK, FAKE_WORKER_DELAY_MS: '5000' });
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 100);

    await expect(rig.routed.transcribe({ pcm: pcm(TWO_SECONDS), selection: SK_CS, kind: 'final', signal: controller.signal })).rejects.toThrow();

    expect(rig.conditioned.ready()).toBe(false);
    expect(rig.verbatim.ready()).toBe(false);
  });

  it('stops the verbatim model when the conditioned model fails', async () => {
    await startWith(rig.identifier, CONFIDENT_SK);
    await startWith(rig.conditioned, { FAKE_WORKER_CRASH_SAMPLES: String(TWO_SECONDS) });
    await startWith(rig.verbatim, { FAKE_WORKER_SLOW_SAMPLES: String(TWO_SECONDS), FAKE_WORKER_SLOW_MS: '5000' });
    const verbatimPid = pidOf(await rig.verbatim.transcribe({ pcm: pcm(1), language: 'auto' }));
    const started = performance.now();

    await expect(rig.routed.transcribe({ pcm: pcm(TWO_SECONDS), selection: SK_CS, kind: 'final' })).rejects.toMatchObject({ reason: 'exit' });

    expect(performance.now() - started).toBeLessThan(1_000);
    expect(pidOf(await rig.verbatim.transcribe({ pcm: pcm(1), language: 'auto' }))).not.toBe(verbatimPid);
  });
});

describe('RoutedTranscriber partials', () => {
  it('uses only the conditioned model when the language is confident', async () => {
    await startWith(rig.identifier, CONFIDENT_SK);

    const result = await rig.routed.transcribe({ pcm: pcm(TWO_SECONDS), selection: SK_CS, kind: 'partial' });

    expect(result).toMatchObject({ route: 'conditioned', language: 'sk' });
    expect(result.text).toMatch(/:sk:32000$/);
    expect(rig.verbatim.ready()).toBe(false);
  });

  it('skips the guard on a confident partial', async () => {
    await startWith(rig.identifier, { FAKE_WORKER_LID_TOP: 'en', FAKE_WORKER_LID_P: '0.995' });
    await startWith(rig.conditioned, { FAKE_WORKER_REPLY_TEXT: SK_GIBSON.canaryEn });

    const result = await rig.routed.transcribe({ pcm: pcm(TWO_SECONDS), selection: SK_EN, kind: 'partial' });

    expect(result).toEqual({ text: SK_GIBSON.canaryEn, language: 'en', route: 'conditioned' });
    expect(rig.verbatim.ready()).toBe(false);
  });

  it('uses only the verbatim model when the language is unsure, even in a foreign script', async () => {
    await startWith(rig.identifier, UNSURE_SK);
    await startWith(rig.verbatim, { FAKE_WORKER_REPLY_TEXT: UK_DRIFT });

    const result = await rig.routed.transcribe({ pcm: pcm(TWO_SECONDS), selection: SK_CS, kind: 'partial' });

    expect(result).toEqual({ text: UK_DRIFT, language: null, route: 'verbatim-unsure' });
    expect(rig.conditioned.ready()).toBe(false);
  });

  it('keeps short and foreign partials verbatim', async () => {
    await startWith(rig.identifier, { FAKE_WORKER_LID_TOP: 'de', FAKE_WORKER_LID_P: '0.999' });

    const short = await rig.routed.transcribe({ pcm: pcm(4_000), selection: SK_CS, kind: 'partial' });
    const foreign = await rig.routed.transcribe({ pcm: pcm(TWO_SECONDS), selection: SK_CS, kind: 'partial' });

    expect(short.route).toBe('verbatim-short');
    expect(foreign.route).toBe('verbatim-foreign');
    expect(rig.conditioned.ready()).toBe(false);
  });
});
