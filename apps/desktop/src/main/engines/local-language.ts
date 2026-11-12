import type { TranscribeLanguage } from '@codevo-whisper/stt-runner';
import { primaryLanguage, type LanguageSelection } from '../../shared/dictation-languages';
import type { LanguageHint } from '../../shared/models';
import type { EngineUnavailableReason } from './transcription-engine';

export type LocalLanguagePlan = { ready: true; hint: TranscribeLanguage } | { ready: false; reason: EngineUnavailableReason };

const WORKER_LANGUAGES: readonly TranscribeLanguage[] = ['sk', 'cs', 'en'];

export function localLanguagePlan(selection: LanguageSelection, modelHint: LanguageHint | null): LocalLanguagePlan {
  if (selection.mode === 'auto') {
    return modelHint === 'required' ? { ready: false, reason: 'languages-required' } : { ready: true, hint: 'auto' };
  }
  const primary = primaryLanguage(selection);
  const hint = WORKER_LANGUAGES.find((language) => language === primary);
  if (modelHint !== 'required' || hint === undefined) {
    return { ready: false, reason: 'languages-pack-missing' };
  }
  return { ready: true, hint };
}
