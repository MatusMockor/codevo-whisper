import type { EngineUnavailableReason } from '../engines/transcription-engine';
import type { LanguageSelection } from '../../shared/dictation-languages';
import { languageCoverage, type LanguageCoverage } from '../../shared/server-languages';
import { routesLanguages, type ModelTarget } from './requested-model';
import type { ReadyConnection } from './server-connector';

export type LanguageTarget = ModelTarget & Pick<ReadyConnection, 'languages'>;

export interface ServerLanguageSupport {
  unavailableReason(selection: LanguageSelection, server: LanguageTarget): EngineUnavailableReason | null;
}

const REASONS: Readonly<Record<LanguageCoverage, EngineUnavailableReason | null>> = Object.freeze({
  covered: null,
  outdated: 'server-languages-outdated',
  missing: 'server-languages-missing',
});

export class ServerLanguageGate implements ServerLanguageSupport {
  unavailableReason(selection: LanguageSelection, server: LanguageTarget): EngineUnavailableReason | null {
    if (selection.mode === 'auto' || !routesLanguages(server)) {
      return null;
    }
    return REASONS[languageCoverage(server.languages, selection.selected)];
  }
}
