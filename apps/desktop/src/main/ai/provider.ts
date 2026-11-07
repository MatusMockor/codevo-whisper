import type { Settings } from '../../shared/settings';
import { codexProvider } from './codex-cli';
import { serverProvider, type Complete } from './llm-client';

export type ProviderSettings = Pick<Settings, 'aiProvider' | 'aiBaseUrl' | 'aiModel' | 'codexModel' | 'codexEffort'>;

export async function chooseProvider(settings: ProviderSettings, apiKey: () => Promise<string | null>, env: NodeJS.ProcessEnv = process.env): Promise<Complete | null> {
  if (settings.aiProvider === 'codex') return codexProvider({ model: settings.codexModel, effort: settings.codexEffort, env });
  if (settings.aiBaseUrl === null || settings.aiModel === '') return null;
  return serverProvider({ baseUrl: settings.aiBaseUrl, model: settings.aiModel, apiKey: await apiKey() });
}
