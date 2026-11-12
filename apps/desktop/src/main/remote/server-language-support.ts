import type { EngineUnavailableReason } from '../engines/transcription-engine';
import type { Settings } from '../../shared/settings';

export interface ServerLanguageSupport {
  unavailableReason(): EngineUnavailableReason | null;
}

export class AutoOnlyServerLanguages implements ServerLanguageSupport {
  constructor(private readonly settings: { get(): Pick<Settings, 'languages'> }) {}

  unavailableReason(): EngineUnavailableReason | null {
    if (this.settings.get().languages.mode === 'auto') {
      return null;
    }
    return 'server-languages-outdated';
  }
}
