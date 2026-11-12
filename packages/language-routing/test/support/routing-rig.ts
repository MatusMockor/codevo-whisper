import { fileURLToPath } from 'node:url';
import { ResidentLanguageIdentifier, ResidentTranscriber, type ResidentWorkerOptions } from '@codevo-whisper/stt-runner';
import { expect, vi } from 'vitest';
import { RoutedTranscriber } from '../../src/index';

const FAKE_WORKER = fileURLToPath(new URL('../../../stt-runner/test/support/fake-worker.js', import.meta.url));

export type WorkerEnv = Readonly<Record<string, string>>;

export type RoutingRig = {
  identifier: ResidentLanguageIdentifier;
  conditioned: ResidentTranscriber;
  verbatim: ResidentTranscriber;
  routed: RoutedTranscriber;
};

function options(model: string, backend: ResidentWorkerOptions['backend']): ResidentWorkerOptions {
  return { binary: FAKE_WORKER, model, backend, threads: 1, abortGraceMs: 100, backoff: { initialMs: 20, maxMs: 100 } };
}

export type RigOverrides = { verbatim?: Partial<ResidentWorkerOptions> };

export function createRig(overrides: RigOverrides = {}): RoutingRig {
  const identifier = new ResidentLanguageIdentifier(options('/models/lang-id-voxlingua107-ecapa-Q8_0.gguf', 'cpu'));
  const conditioned = new ResidentTranscriber(options('/models/canary-1b-v2-Q8_0.gguf', 'vulkan'));
  const verbatim = new ResidentTranscriber({ ...options('/models/parakeet-ultra-F16.gguf', 'vulkan'), ...overrides.verbatim });
  return { identifier, conditioned, verbatim, routed: new RoutedTranscriber({ identifier, conditioned, verbatim }) };
}

export async function startWith(worker: { warmUp(): Promise<void> }, env: WorkerEnv = {}): Promise<void> {
  Object.entries(env).forEach(([name, value]) => vi.stubEnv(name, value));
  await worker.warmUp();
  vi.unstubAllEnvs();
}

export async function closeRig(rig: RoutingRig): Promise<void> {
  await Promise.all([rig.identifier.close(), rig.conditioned.close(), rig.verbatim.close()]);
}

export function pcm(samples: number): Uint8Array {
  return new Uint8Array(samples * 2);
}

export function pidOf(text: string): string {
  return text.split(':')[0] ?? '';
}

export async function waitForFailure(worker: { ready(): boolean }): Promise<void> {
  await expect.poll(() => worker.ready(), { interval: 5, timeout: 2_000 }).toBe(false);
}

export function settlement(promise: Promise<unknown>): () => boolean {
  let settled = false;
  const mark = (): void => {
    settled = true;
  };
  promise.then(mark, mark);
  return () => settled;
}
