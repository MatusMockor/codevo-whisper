export const LANGUAGE_CODES = ['bg', 'cs', 'da', 'de', 'el', 'en', 'es', 'et', 'fi', 'fr', 'hr', 'hu', 'it', 'lt', 'lv', 'mt', 'nl', 'pl', 'pt', 'ro', 'ru', 'sk', 'sl', 'sv', 'uk'] as const;

export type LanguageCode = (typeof LANGUAGE_CODES)[number];

export type LanguageScore = { code: LanguageCode; p: number };

const KNOWN: ReadonlySet<string> = new Set(LANGUAGE_CODES);

export function isLanguageCode(value: string): value is LanguageCode {
  return KNOWN.has(value);
}

export function assertLanguageSet(codes: readonly string[]): void {
  if (codes.length === 0) {
    throw new RangeError('a language set holds at least one language');
  }
  const unknown = codes.find((code) => !isLanguageCode(code));
  if (unknown !== undefined) {
    throw new RangeError(`unsupported language ${JSON.stringify(unknown)}`);
  }
  if (new Set(codes).size !== codes.length) {
    throw new RangeError('a language set holds each language once');
  }
}
