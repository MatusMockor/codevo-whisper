import type { TranscribeLanguage } from '@codevo-whisper/stt-runner';
import { primaryLanguage, type LanguageSelection } from '../../shared/dictation-languages';
import type { LanguageHint } from '../../shared/models';
import type { EngineUnavailableReason } from './transcription-engine';

const WORKER_LANGUAGES: readonly TranscribeLanguage[] = ['sk', 'cs', 'en'];

export function localLanguageHint(selection: LanguageSelection): TranscribeLanguage | null {
  if (selection.mode === 'auto') {
    return 'auto';
  }
  const primary = primaryLanguage(selection);
  return WORKER_LANGUAGES.find((language) => language === primary) ?? null;
}

export function localLanguageReason(selection: LanguageSelection, hint: LanguageHint | null): EngineUnavailableReason | null {
  if (selection.mode === 'auto') {
    return hint === 'required' ? 'languages-required' : null;
  }
  if (hint !== 'required' || localLanguageHint(selection) === null) {
    return 'languages-pack-missing';
  }
  return null;
}
