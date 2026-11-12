import type { LanguageSelection } from '../../shared/dictation-languages';
import type { LanguageHint } from '../../shared/models';

export function meetingLanguageArgs(selection: LanguageSelection, hint: LanguageHint | null): string[] {
  const [only, ...others] = selection.selected;
  if (hint !== 'optional' || selection.mode !== 'selected' || only === undefined || others.length > 0) {
    return [];
  }
  return ['--language', only];
}
