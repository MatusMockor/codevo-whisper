import { isSupportedLanguage, MAX_SELECTED_LANGUAGES, type SupportedLanguage } from './languages';

function invalidReason(codes: readonly string[]): string | null {
  if (codes.length === 0) {
    return 'a language selection holds at least one language';
  }
  if (codes.length > MAX_SELECTED_LANGUAGES) {
    return `a language selection holds at most ${MAX_SELECTED_LANGUAGES} languages`;
  }
  const unsupported = codes.find((code) => !isSupportedLanguage(code));
  if (unsupported !== undefined) {
    return `unsupported language ${JSON.stringify(unsupported)}`;
  }
  if (new Set(codes).size !== codes.length) {
    return 'a language selection holds each language once';
  }
  return null;
}

export class LanguageSelection {
  private constructor(
    readonly codes: readonly SupportedLanguage[],
    private readonly primaryCode: SupportedLanguage,
  ) {}

  static of(codes: readonly string[]): LanguageSelection {
    const reason = invalidReason(codes);
    if (reason !== null) {
      throw new RangeError(reason);
    }
    const supported = codes.filter(isSupportedLanguage);
    return new LanguageSelection(Object.freeze([...supported]), supported[0] as SupportedLanguage);
  }

  static isValid(codes: readonly string[]): boolean {
    return invalidReason(codes) === null;
  }

  get size(): number {
    return this.codes.length;
  }

  primary(): SupportedLanguage {
    return this.primaryCode;
  }

  has(code: string): boolean {
    return this.codes.includes(code as SupportedLanguage);
  }
}
