import { isEngineSwitch, type EngineRefusal } from '../../shared/engine-routing';
import type { IpcInvokeApi } from '../../shared/ipc-contract';
import type { EngineId } from '../../shared/settings';

export type EngineSwitchApi = Pick<IpcInvokeApi, 'preferEngine'>;

export const SWITCH_FAILED_MESSAGE = 'Prepis sa nepodarilo prepnúť. Skúste to znova.';

export const ENABLE_FAILED_MESSAGE = 'Server sa nepodarilo pripojiť. Skúste to znova.';

export const SWITCH_REFUSED_MESSAGES: Readonly<Record<EngineRefusal, string>> = Object.freeze({
  'no-model': 'Prepis sa nepodarilo prepnúť, lokálny model nie je stiahnutý. Stiahnite ho a skúste to znova.',
  'server-not-paired': 'Prepis sa nepodarilo prepnúť, server nie je pripravený. Skontrolujte párovanie na stránke Prepis a skúste to znova.',
});

export function switchFailure(outcome: unknown): string | null {
  if (!isEngineSwitch(outcome)) {
    return SWITCH_FAILED_MESSAGE;
  }
  if (outcome.kind === 'switched') {
    return null;
  }
  return SWITCH_REFUSED_MESSAGES[outcome.reason];
}

export function switchEngine(engine: EngineId, api: EngineSwitchApi): Promise<string | null> {
  return api.preferEngine(engine).then(switchFailure, (error: unknown) => {
    console.error('Switching the transcription engine failed', error);
    return SWITCH_FAILED_MESSAGE;
  });
}
