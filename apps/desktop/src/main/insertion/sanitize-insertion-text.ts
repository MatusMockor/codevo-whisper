const LINE_BREAKS = /[\t\n\v\f\r\u0085\p{Zl}\p{Zp}]+/gu;
const HIDDEN_CHARACTERS = /[\p{Cc}\p{Cf}]/gu;
const SPACE_RUNS = / {2,}/g;

export function sanitizeInsertionText(text: string): string {
  return text.replace(LINE_BREAKS, ' ').replace(HIDDEN_CHARACTERS, '').replace(SPACE_RUNS, ' ').trim().normalize('NFC');
}
