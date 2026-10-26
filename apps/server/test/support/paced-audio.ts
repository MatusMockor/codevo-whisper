import type { TestSession } from './test-client';

export type ManualClock = { now: number };

export type PacedOptions = { clock: ManualClock; frameMs?: number; yieldMs?: number };

function yieldToServer(ms = 1): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function streamPaced(sessions: TestSession[], pcm: Uint8Array, options: PacedOptions): Promise<void> {
  const frameMs = options.frameMs ?? 100;
  const frameBytes = frameMs * 32;
  for (let offset = 0; offset < pcm.length; offset += frameBytes) {
    options.clock.now += frameMs;
    const frame = pcm.subarray(offset, offset + frameBytes);
    sessions.forEach((session) => session.send({ type: 'audio', pcm: frame }));
    await yieldToServer(options.yieldMs);
  }
}

export async function sendInChunks(session: TestSession, pcm: Uint8Array, options: PacedOptions): Promise<void> {
  const frameMs = options.frameMs ?? 10_000;
  const frameBytes = frameMs * 32;
  for (let offset = 0; offset < pcm.length; offset += frameBytes) {
    const chunk = pcm.subarray(offset, offset + frameBytes);
    for (let inner = 0; inner < chunk.length; inner += 32_000) {
      session.send({ type: 'audio', pcm: chunk.subarray(inner, inner + 32_000) });
    }
    options.clock.now += frameMs;
    await yieldToServer();
  }
}
