import type { MicrophoneSettings } from '../audio/microphone-settings';
import type { HandlerGroup } from './invoke-handlers';
import { validateMicrophones } from './validate';

export type MicrophoneHandlerDeps = { microphones: Pick<MicrophoneSettings, 'list' | 'startMeter' | 'stopMeter'> };

export function microphoneHandlers({ microphones }: MicrophoneHandlerDeps): HandlerGroup<'getMicrophones' | 'startMicrophoneMeter' | 'stopMicrophoneMeter'> {
  return {
    getMicrophones: () => microphones.list(),
    startMicrophoneMeter: (list) => microphones.startMeter(validateMicrophones(list)),
    stopMicrophoneMeter: () => microphones.stopMeter(),
  };
}
