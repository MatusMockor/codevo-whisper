import type { AudioCapture } from '../audio/audio-capture';
import type { InputHelper } from '../helper/input-helper';
import type { LastTranscript } from '../insertion/last-transcript';
import type { AppUpdater } from '../updates/app-updater';
import type { UpdaterLike } from '../updates/electron-updater-adapter';
import type { OverlayState } from '../../shared/overlay-contract';

export type E2eHooks = {
  capture: AudioCapture;
  overlay: { show(state: OverlayState): void };
  lastTranscript: Pick<LastTranscript, 'set'>;
  helper: InputHelper;
  updater?: AppUpdater | null;
  loadUpdater?: () => Promise<UpdaterLike>;
};

export function exposeE2eHooks(enabled: boolean, hooks: E2eHooks): void {
  if (!enabled) {
    return;
  }
  Object.defineProperty(globalThis, 'codevoE2e', { value: Object.freeze(hooks) });
}
