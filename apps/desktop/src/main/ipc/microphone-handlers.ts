import type { MicrophoneSettings } from '../audio/microphone-settings';
import type { HandlerGroup } from './invoke-handlers';
import { validateMicrophone } from './validate';

export type MicrophoneHandlerDeps = { microphones: Pick<MicrophoneSettings, 'list' | 'startMeter' | 'stopMeter'> };

export function microphoneHandlers({ microphones }: MicrophoneHandlerDeps): HandlerGroup<'getMicrophones' | 'startMicrophoneMeter' | 'stopMicrophoneMeter'> {
  return {
    getMicrophones: () => microphones.list(),
    startMicrophoneMeter: (microphone) => microphones.startMeter(validateMicrophone(microphone)),
    stopMicrophoneMeter: () => microphones.stopMeter(),
  };
}
