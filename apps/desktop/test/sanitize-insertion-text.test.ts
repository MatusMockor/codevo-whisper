import { describe, expect, it } from 'vitest';
import { sanitizeInsertionText } from '../src/main/insertion/sanitize-insertion-text';

const ESC = '\u001b';

describe('sanitizeInsertionText', () => {
  it('adds exactly one explicit safe trailing space only to nonempty sanitized text', () => {
    expect(sanitizeInsertionText(' hi\r\nthere\u001b[201~  ', { appendTrailingSpace: true })).toBe('hi there[201~ ');
    expect(sanitizeInsertionText(' \n\u0000 ', { appendTrailingSpace: true })).toBe('');
    expect(sanitizeInsertionText('hi ', { appendTrailingSpace: false })).toBe('hi');
  });
  it('keeps Slovak text with diacritics unchanged', () => {
    expect(sanitizeInsertionText('Dobrý deň, ďakujem')).toBe('Dobrý deň, ďakujem');
  });

  it('turns LF, CR and CRLF into a single space so a terminal never receives Enter', () => {
    expect(sanitizeInsertionText('ls\nrm -rf ~')).toBe('ls rm -rf ~');
    expect(sanitizeInsertionText('ls\rrm -rf ~')).toBe('ls rm -rf ~');
    expect(sanitizeInsertionText('ls\r\nrm -rf ~')).toBe('ls rm -rf ~');
    expect(sanitizeInsertionText('jeden\n\n\r\ndva')).toBe('jeden dva');
  });

  it('turns tabs and Unicode line and paragraph separators into a single space', () => {
    expect(sanitizeInsertionText('jeden\tdva')).toBe('jeden dva');
    expect(sanitizeInsertionText('jeden\u2028dva\u2029tri')).toBe('jeden dva tri');
    expect(sanitizeInsertionText('jeden\u000bdva\u000ctri\u0085štyri')).toBe('jeden dva tri štyri');
  });

  it('collapses the spaces around replaced breaks and trims the ends', () => {
    expect(sanitizeInsertionText('  jeden \n dva  \t  tri \n')).toBe('jeden dva tri');
  });

  it('leaves no ESC from a bracketed paste end sequence or other escape sequences', () => {
    const sanitized = sanitizeInsertionText(`ahoj${ESC}[201~echo pwned${ESC}[200~`);

    expect(sanitized).not.toContain(ESC);
    expect(sanitized).toBe('ahoj[201~echo pwned[200~');
    expect(sanitizeInsertionText(`${ESC}]0;title\u0007text`)).toBe(']0;titletext');
  });

  it('removes NUL, DEL and every other C0 control', () => {
    expect(sanitizeInsertionText('a\u0000b\u007fc')).toBe('abc');
    const c0 = Array.from({ length: 0x20 }, (_, code) => String.fromCharCode(code)).join('');

    expect(sanitizeInsertionText(`x${c0}y`)).toBe('x y');
  });

  it('removes C1 controls', () => {
    const c1 = Array.from({ length: 0x20 }, (_, index) => String.fromCharCode(0x80 + index))
      .filter((char) => char !== '\u0085')
      .join('');

    expect(sanitizeInsertionText(`x${c1}y`)).toBe('xy');
    expect(sanitizeInsertionText('a\u009b31mb')).toBe('a31mb');
  });

  it.each([
    ['U+200B zero width space', '\u200b'],
    ['U+200C zero width non-joiner', '\u200c'],
    ['U+200D zero width joiner', '\u200d'],
    ['U+200E left-to-right mark', '\u200e'],
    ['U+200F right-to-left mark', '\u200f'],
    ['U+202A left-to-right embedding', '\u202a'],
    ['U+202B right-to-left embedding', '\u202b'],
    ['U+202C pop directional formatting', '\u202c'],
    ['U+202D left-to-right override', '\u202d'],
    ['U+202E right-to-left override', '\u202e'],
    ['U+2060 word joiner', '\u2060'],
    ['U+2061 function application', '\u2061'],
    ['U+2062 invisible times', '\u2062'],
    ['U+2063 invisible separator', '\u2063'],
    ['U+2064 invisible plus', '\u2064'],
    ['U+2066 left-to-right isolate', '\u2066'],
    ['U+2067 right-to-left isolate', '\u2067'],
    ['U+2068 first strong isolate', '\u2068'],
    ['U+2069 pop directional isolate', '\u2069'],
    ['U+FEFF byte order mark', '\ufeff'],
    ['U+180E Mongolian vowel separator', '\u180e'],
    ['U+061C Arabic letter mark', '\u061c'],
  ])('removes %s', (_name, char) => {
    expect(sanitizeInsertionText(`pre${char}fix ${char}${char}koniec${char}`)).toBe('prefix koniec');
  });

  it('removes every other invisible format character such as the soft hyphen and tag characters', () => {
    const hiddenTags = String.fromCodePoint(0xe0001, 0xe0072, 0xe006d, 0xe007f);

    expect(sanitizeInsertionText('ne\u00adviditeľný')).toBe('neviditeľný');
    expect(sanitizeInsertionText(`ahoj${hiddenTags} svet\ufff9`)).toBe('ahoj svet');
  });

  it('removes a Trojan Source bidi override so the visible order is the real order', () => {
    expect(sanitizeInsertionText('access = "user\u202e \u2066// admin\u2069 \u2066"')).toBe('access = "user // admin "');
  });

  it('keeps emoji and splits joined emoji into their parts', () => {
    expect(sanitizeInsertionText('Super 👍🏽 ❤\ufe0f 🇸🇰')).toBe('Super 👍🏽 ❤\ufe0f 🇸🇰');
    expect(sanitizeInsertionText('rodina 👨\u200d👩\u200d👧')).toBe('rodina 👨👩👧');
  });

  it('normalizes decomposed letters to NFC', () => {
    const decomposed = 'Dobry\u0301 den\u030c';

    expect(sanitizeInsertionText(decomposed)).toBe('Dobrý deň');
    expect(sanitizeInsertionText('e\u200b\u0301')).toBe('é');
  });

  it('returns an empty string when nothing visible remains', () => {
    expect(sanitizeInsertionText('')).toBe('');
    expect(sanitizeInsertionText(` \r\n\t${ESC}\u0000\u200b\u202e\ufeff `)).toBe('');
  });
});
