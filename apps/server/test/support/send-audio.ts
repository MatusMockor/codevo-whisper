import type { TestSession } from './test-client';

const FRAME_BYTES = 32_000;

export function sendAudio(session: TestSession, pcm: Uint8Array): void {
  for (let offset = 0; offset < pcm.length; offset += FRAME_BYTES) {
    session.send({ type: 'audio', pcm: pcm.subarray(offset, offset + FRAME_BYTES) });
  }
}
