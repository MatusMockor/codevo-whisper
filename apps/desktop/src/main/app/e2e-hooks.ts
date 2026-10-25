import type { AudioCapture } from '../audio/audio-capture';

export type E2eHooks = { capture: AudioCapture };

export function exposeE2eHooks(enabled: boolean, hooks: E2eHooks): void {
  if (!enabled) {
    return;
  }
  Object.defineProperty(globalThis, 'codevoE2e', { value: Object.freeze(hooks) });
}
