import { app } from 'electron';
import { join } from 'node:path';
import type { AiCheck, AiKeyState } from '../../shared/ai';
import { AiKeyStore } from '../ai/ai-key-store';
import { listModels, LlmError } from '../ai/llm-client';
import { polish } from '../ai/polish';
import type { Logger } from '../logging/logger';
import type { SettingsStore } from '../settings/settings-store';
import { vaultFor } from './server-wiring';

const AI_KEY_FILE = 'ai-key.json';

export type AiWiringDeps = { settings: Pick<SettingsStore, 'get'>; e2e: boolean; isPackaged: boolean; logger: Logger };

export type AiServices = {
  keyState(): Promise<AiKeyState>;
  setKey(key: string | null): Promise<AiKeyState>;
  check(baseUrl: string): Promise<AiCheck>;
  polish(text: string, signal: AbortSignal): Promise<string>;
};

export function createAiServices({ settings, e2e, isPackaged, logger }: AiWiringDeps): AiServices {
  const keys = new AiKeyStore(join(app.getPath('userData'), AI_KEY_FILE), vaultFor({ e2e, isPackaged }), logger);
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
    polish: async (text, signal) => {
      const { aiBaseUrl, aiModel } = settings.get();
      if (aiBaseUrl === null) return text;
      return polish(text, { endpoint: { baseUrl: aiBaseUrl, model: aiModel, apiKey: await keys.get() }, signal, logger });
    },
  };
}
