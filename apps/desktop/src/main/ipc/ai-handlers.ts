import type { AiServices } from '../app/ai-wiring';
import type { HandlerGroup } from './invoke-handlers';
import { validateAiBaseUrl, validateAiKey } from './validate';
import { withoutArguments } from './without-arguments';

export type AiHandlerDeps = { ai: Pick<AiServices, 'keyState' | 'setKey' | 'check'> };

export function aiHandlers({ ai }: AiHandlerDeps): HandlerGroup<'getAiKeyState' | 'setAiKey' | 'checkAi'> {
  return {
    getAiKeyState: withoutArguments(() => ai.keyState()),
    setAiKey: (key) => Promise.resolve().then(() => ai.setKey(validateAiKey(key))),
    checkAi: (baseUrl) => Promise.resolve().then(() => ai.check(validateAiBaseUrl(baseUrl))),
  };
}
