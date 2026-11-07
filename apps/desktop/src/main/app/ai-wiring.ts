import { app } from 'electron';
import { join } from 'node:path';
import type { AiCheck, AiKeyState, CodexCheck, CodexEffort } from '../../shared/ai';
import { AiKeyStore } from '../ai/ai-key-store';
import { checkCodex } from '../ai/codex-cli';
import { listModels, LlmError, type Complete } from '../ai/llm-client';
import { polish } from '../ai/polish';
import { chooseProvider } from '../ai/provider';
import type { Logger } from '../logging/logger';
import type { SettingsStore } from '../settings/settings-store';
import { vaultFor } from './server-wiring';

const AI_KEY_FILE = 'ai-key.json';

export type AiWiringDeps = { settings: Pick<SettingsStore, 'get'>; e2e: boolean; isPackaged: boolean; logger: Logger };

export type AiServices = {
  keyState(): Promise<AiKeyState>;
  setKey(key: string | null): Promise<AiKeyState>;
  check(baseUrl: string): Promise<AiCheck>;
  checkCodex(model: string, effort: CodexEffort): Promise<CodexCheck>;
  polish(text: string, signal: AbortSignal): Promise<string>;
  provider(): Promise<Complete | null>;
};

export function createAiServices({ settings, e2e, isPackaged, logger }: AiWiringDeps): AiServices {
  const keys = new AiKeyStore(join(app.getPath('userData'), AI_KEY_FILE), vaultFor({ e2e, isPackaged }), logger);
  const provider = (): Promise<Complete | null> => chooseProvider(settings.get(), () => keys.get());
  return {
    keyState: () => keys.state(),
    setKey: (key) => keys.set(key),
    check: async (baseUrl) => {
      try {
        return { ok: true, models: await listModels({ baseUrl, apiKey: await keys.get() }) };
      } catch (error) {
        if (error instanceof LlmError) return { ok: false, error: error.reason };
        throw error;
      }
    },
    checkCodex: (model, effort) => checkCodex({ model, effort }),
    polish: async (text, signal) => {
      const complete = await provider();
      return complete === null ? text : polish(text, { complete, signal, logger });
    },
    provider,
  };
}
