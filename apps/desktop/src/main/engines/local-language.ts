import type { TranscribeLanguage } from '@codevo-whisper/stt-runner';
import { primaryLanguage, type DictationLanguage, type LanguageSelection } from '../../shared/dictation-languages';
import type { LanguageHint } from '../../shared/models';
import type { EngineUnavailableReason } from './transcription-engine';

export type LocalLanguagePlan =
  | { kind: 'direct'; hint: TranscribeLanguage }
  | { kind: 'routed'; selected: readonly DictationLanguage[] }
  | { kind: 'unavailable'; reason: EngineUnavailableReason };

export type ReadyLanguagePlan = Exclude<LocalLanguagePlan, { kind: 'unavailable' }>;

export function sameSelection(left: LanguageSelection, right: LanguageSelection): boolean {
  return left.mode === right.mode && left.selected.length === right.selected.length && left.selected.every((code, index) => right.selected[index] === code);
}

export function needsLanguagePack(selection: LanguageSelection, modelHint: LanguageHint | null): boolean {
  return selection.mode === 'selected' && modelHint !== 'required';
}

export function localLanguagePlan(selection: LanguageSelection, modelHint: LanguageHint | null, packReady: boolean): LocalLanguagePlan {
  if (selection.mode === 'auto') {
    return modelHint === 'required' ? { kind: 'unavailable', reason: 'languages-required' } : { kind: 'direct', hint: 'auto' };
  }
  const primary = primaryLanguage(selection);
  if (primary === null) {
    return { kind: 'unavailable', reason: 'languages-required' };
  }
  if (modelHint === 'required') {
    return { kind: 'direct', hint: primary };
  }
  if (!packReady) {
    return { kind: 'unavailable', reason: 'languages-pack-missing' };
  }
  return { kind: 'routed', selected: selection.selected };
}
