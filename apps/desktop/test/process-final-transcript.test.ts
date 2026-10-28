import { describe, expect, it } from 'vitest';
import { processFinalTranscript } from '../src/main/session/process-final-transcript';
import { DEFAULT_SETTINGS, type Settings } from '../src/shared/settings';

function process(text: string, settings: Partial<Settings> = {}): string {
  return processFinalTranscript({ text, settings: { ...DEFAULT_SETTINGS, ...settings } });
}

describe('processFinalTranscript', () => {
  it('applies spacing after removing fillers and correcting words', () => {
    expect(process('ehm, Kumba\n', { customWords: ['Kumiba'], removeFillerWords: true, appendTrailingSpace: true })).toBe('Kumiba ');
    expect(process('um.', { language: 'en', removeFillerWords: true, appendTrailingSpace: true })).toBe('');
  });
  it('canonicalizes exact and unique one-edit words while preserving punctuation and diacritics', () => {
    expect(process('kumiba, Kumiba! Kumiba? Kumba. Žilina Zilina.', { customWords: ['Kumiba', 'Žilina'] }))
      .toBe('Kumiba, Kumiba! Kumiba? Kumiba. Žilina Zilina.');
    expect(process('žiliná Žilna', { customWords: ['Žilina'] })).toBe('Žilina Žilina');
    expect(process('Z\u030cilina', { customWords: ['Žilina'] })).toBe('Žilina');
  });

  it('leaves ties, short, distant and embedded words unchanged without cascading replacements', () => {
    expect(process('Kumiba kumbia kumibo', { customWords: ['Kumina', 'Kumika'] })).toBe('Kumiba kumbia kumibo');
    expect(process('cat dog sumiba kumi', { customWords: ['Cat', 'Kumiba'] })).toBe('Cat dog sumiba kumi');
    expect(process('https://Kumba.dev a@Kumba.dev /Kumba Kumba/file `Kumba` Kumba-foo Kumba2 foo_Kumba', { customWords: ['Kumiba'] }))
      .toBe('https://Kumba.dev a@Kumba.dev /Kumba Kumba/file `Kumba` Kumba-foo Kumba2 foo_Kumba');
    expect(process('Kumba', { customWords: ['Kumiba', 'Kumina'] })).toBe('Kumiba');
  });
  it('preserves the default sanitized text', () => {
    expect(process('  Ehm,\r\nKumiba\u001b[201~  ')).toBe('Ehm, Kumiba[201~');
  });

  it('keeps filler substrings inside identifiers and domain-like tokens', () => {
    expect(process('hmming album umbilical foo_hmm_bar eee.com hmm/path', { language: 'auto', removeFillerWords: true }))
      .toBe('hmming album umbilical foo_hmm_bar eee.com hmm/path');
  });

  it('uses the selected language list and the union for auto', () => {
    expect(process('ehm eee um uh hmm', { language: 'en', removeFillerWords: true })).toBe('ehm eee');
    expect(process('ehm eee um uh hmm', { language: 'sk', removeFillerWords: true })).toBe('um uh');
    expect(process('ehm eee um uh hmm', { language: 'cs', removeFillerWords: true })).toBe('um uh');
    expect(process('ehm eee um uh hmm', { language: 'auto', removeFillerWords: true })).toBe('');
  });

  it.each([
    ['sk', 'Ehm, eee; HMM!'], ['en', 'UM, uh; HMM!'], ['cs', 'Ehm, eee; HMM!'], ['auto', 'Ehm, eee; HMM! um uh.'],
  ] as const)('removes only whole hesitation tokens in %s', (language, fillers) => {
    expect(process(`${fillers} Dobrý deň, like well ako no hummus album.`, { language, removeFillerWords: true }))
      .toBe('Dobrý deň, like well ako no hummus album.');
    expect(process(fillers, { language, removeFillerWords: true })).toBe('');
    expect(process('Ahoj, hmm, svet!', { language, removeFillerWords: true })).toBe('Ahoj, svet!');
  });
});
