import type { EngineUnavailableReason } from '../engines/transcription-engine';
import type { LanguageSelection } from '../../shared/dictation-languages';
import { languageCoverage, type LanguageCoverage, type ServerLanguages } from '../../shared/server-languages';

export interface ServerLanguageSupport {
  unavailableReason(selection: LanguageSelection, server: ServerLanguages): EngineUnavailableReason | null;
}

const REASONS: Readonly<Record<LanguageCoverage, EngineUnavailableReason | null>> = Object.freeze({
  covered: null,
  outdated: 'server-languages-outdated',
  missing: 'server-languages-missing',
});

export class ServerLanguageGate implements ServerLanguageSupport {
  unavailableReason(selection: LanguageSelection, server: ServerLanguages): EngineUnavailableReason | null {
    if (selection.mode === 'auto') {
      return null;
    }
    return REASONS[languageCoverage(server, selection.selected)];
  }
}
