import type { LanguageSelection } from '../language-selection';
import type { SupportedLanguage } from '../languages';
import { ALPHABETS } from './alphabets';

const LETTER = /[\p{L}\p{M}]/u;

export class OrthographyCheck {
  constructor(private readonly alphabets: Readonly<Record<SupportedLanguage, string>> = ALPHABETS) {}

  isConsistent(text: string, selection: LanguageSelection): boolean {
    const allowed = new Set(selection.codes.flatMap((code) => Array.from(this.alphabets[code])));
    return Array.from(text.toLowerCase().normalize('NFC')).every((char) => !LETTER.test(char) || allowed.has(char));
  }
}
