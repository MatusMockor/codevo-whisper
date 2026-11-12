import { LanguageSelection } from '@codevo-whisper/language-routing';
import type { TranscriptionJob } from '@codevo-whisper/audio';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocalResidents } from '../src/main/engines/local-residents';
import { RoutedSegmentTranscriber, type RoutedContext, type RoutedResidents } from '../src/main/engines/routed-segment-transcriber';
import { PCM_BYTES_PER_SECOND } from '../src/shared/pcm';

const BINARY = fileURLToPath(new URL('./support/routed-worker.js', import.meta.url));
const CYRILLIC = 'привіт світ';
const SK_CS = LanguageSelection.of(['sk', 'cs']);

let residents: RoutedResidents;

function job(kind: 'partial' | 'final', pcm = new Uint8Array(2 * PCM_BYTES_PER_SECOND)): TranscriptionJob<RoutedContext> {
  return { sessionId: 'session', deviceId: 'local', kind, segmentId: 0, revision: 0, pcm, context: { selection: SK_CS } };
}

beforeEach(() => {
  vi.stubEnv('FAKE_WORKER_LID_TOP', 'sk');
  vi.stubEnv('FAKE_WORKER_LID_P', '0.6');
  vi.stubEnv('CW_MODEL_REPLIES', JSON.stringify({ parakeet: CYRILLIC }));
  const local = new LocalResidents({ binary: BINARY, callTimeoutMs: 5_000 }, 'cpu');
  residents = { verbatim: local.transcriber('/models/parakeet.gguf'), conditioned: local.transcriber('/models/canary.gguf'), identifier: local.identifier('/models/langid.gguf') };
});

afterEach(async () => {
  await Promise.all([residents.verbatim.close(), residents.conditioned.close(), residents.identifier.close()]);
  vi.unstubAllEnvs();
});

describe('RoutedSegmentTranscriber', () => {
  it('routes partials and finals with their own rules', async () => {
    const transcriber = new RoutedSegmentTranscriber(residents, Promise.resolve());
    const signal = new AbortController().signal;

    await expect(transcriber.transcribe(job('partial'), signal)).resolves.toBe(CYRILLIC);
    await expect(transcriber.transcribe(job('final'), signal)).resolves.toMatch(/^\d+:sk:32000$/);
  });

  it('waits for the residents to start before routing', async () => {
    const startup = Promise.withResolvers<void>();
    const transcriber = new RoutedSegmentTranscriber(residents, startup.promise);
    let settled = false;

    const pending = transcriber.transcribe(job('final'), new AbortController().signal).finally(() => {
      settled = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(settled).toBe(false);
    expect(residents.verbatim.ready()).toBe(false);

    startup.resolve();
    await expect(pending).resolves.toMatch(/^\d+:sk:32000$/);
  });

  it('skips audio too short to transcribe and refuses a cancelled job', async () => {
    const transcriber = new RoutedSegmentTranscriber(residents, Promise.resolve());
    const controller = new AbortController();

    await expect(transcriber.transcribe(job('final', new Uint8Array(100)), controller.signal)).resolves.toBe('');
    controller.abort();
    await expect(transcriber.transcribe(job('final'), controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(residents.identifier.ready()).toBe(false);
  });
});
