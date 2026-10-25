import type { AudioCapture } from '../audio/audio-capture';
import type { OverlayState } from '../../shared/overlay-contract';

export type E2eHooks = { capture: AudioCapture; overlay: { show(state: OverlayState): void } };

export function exposeE2eHooks(enabled: boolean, hooks: E2eHooks): void {
  if (!enabled) {
    return;
  }
  Object.defineProperty(globalThis, 'codevoE2e', { value: Object.freeze(hooks) });
}
