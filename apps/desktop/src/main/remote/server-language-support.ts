import type { EngineUnavailableReason } from '../engines/transcription-engine';
import type { LanguageSelection } from '../../shared/dictation-languages';

export interface ServerLanguageSupport {
  unavailableReason(selection: LanguageSelection): EngineUnavailableReason | null;
}

export class AutoOnlyServerLanguages implements ServerLanguageSupport {
  unavailableReason(selection: LanguageSelection): EngineUnavailableReason | null {
    if (selection.mode === 'auto') {
      return null;
    }
    return 'server-languages-outdated';
  }
}
