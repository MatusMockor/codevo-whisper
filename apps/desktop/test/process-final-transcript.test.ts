import { describe, expect, it } from 'vitest';
import { processFinalTranscript } from '../src/main/session/process-final-transcript';
import type { CustomWord } from '../src/shared/custom-words';
import { DEFAULT_SETTINGS, type Settings } from '../src/shared/settings';

type Languages = Settings['languages'];

const AUTO: Languages = { mode: 'auto', selected: ['sk'] };

function only(...selected: Languages['selected']): Languages {
  return { mode: 'selected', selected };
}

function entry(word: string, ...aliases: string[]): CustomWord {
  return { word, aliases };
}

function plain(...words: string[]): CustomWord[] {
  return words.map((word) => entry(word));
}

function process(text: string, settings: Partial<Settings> = {}): string {
  return processFinalTranscript({ text, settings: { ...DEFAULT_SETTINGS, ...settings } });
}

describe('processFinalTranscript', () => {
  it('applies spacing after removing fillers and correcting words', () => {
    expect(process('ehm, Kumba\n', { customWords: plain('Kumiba'), removeFillerWords: true, appendTrailingSpace: true })).toBe('Kumiba ');
    expect(process('um.', { languages: only('en'), removeFillerWords: true, appendTrailingSpace: true })).toBe('');
  });
  it('canonicalizes exact and unique one-edit words while preserving punctuation and diacritics', () => {
    expect(process('kumiba, Kumiba! Kumiba? Kumba. Žilina Zilina.', { customWords: plain('Kumiba', 'Žilina') }))
      .toBe('Kumiba, Kumiba! Kumiba? Kumiba. Žilina Zilina.');
    expect(process('žiliná Žilna', { customWords: plain('Žilina') })).toBe('Žilina Žilina');
    expect(process('Z\u030cilina', { customWords: plain('Žilina') })).toBe('Žilina');
  });

  it('leaves ties, short, distant and embedded words unchanged without cascading replacements', () => {
    expect(process('Kumiba kumbia kumibo', { customWords: plain('Kumina', 'Kumika') })).toBe('Kumiba kumbia kumibo');
    expect(process('cat dog sumiba kumi', { customWords: plain('Cat', 'Kumiba') })).toBe('Cat dog sumiba kumi');
    expect(process('https://Kumba.dev a@Kumba.dev /Kumba Kumba/file `Kumba` Kumba-foo Kumba2 foo_Kumba', { customWords: plain('Kumiba') }))
      .toBe('https://Kumba.dev a@Kumba.dev /Kumba Kumba/file `Kumba` Kumba-foo Kumba2 foo_Kumba');
    expect(process('Kumba', { customWords: plain('Kumiba', 'Kumina') })).toBe('Kumiba');
  });
  it('replaces aliases with the preferred spelling regardless of length or case', () => {
    expect(process('deploy to K8S. kodevo!', { customWords: [entry('Kubernetes', 'k8s'), entry('Codevo', 'kodevo')] })).toBe('deploy to Kubernetes. Codevo!');
  });

  it('corrects multi-word terms and aliases, longest first, keeping punctuation at the span edges', () => {
    const customWords = [entry('Codevo Whisper', 'kodevo vysper'), entry('Kumiba MCP', 'kumiba em si pí'), entry('Kumiba')];
    expect(process('codevo whisper a KUMIBA mcp, kumiba em si pí. kumiba!', { customWords })).toBe('Codevo Whisper a Kumiba MCP, Kumiba MCP. Kumiba!');
    expect(process('(kodevo vysper), "kumiba mcp!"', { customWords })).toBe('(Codevo Whisper), "Kumiba MCP!"');
    expect(process('kumiba em si', { customWords })).toBe('Kumiba em si');
  });

  it('leaves multi-word spans with inner punctuation, code-like chunks and near misses unchanged', () => {
    const customWords = [entry('Codevo Whisper'), entry('Kumiba', 'kodevo')];
    expect(process('codevo, whisper codevo (whisper codevo whispr https://codevo whisper codevo/whisper', { customWords }))
      .toBe('codevo, whisper codevo (whisper codevo whispr https://codevo whisper codevo/whisper');
    expect(process('kodeva kodevo', { customWords })).toBe('kodeva Kumiba');
  });

  it('preserves the default sanitized text', () => {
    expect(process('  Ehm,\r\nKumiba\u001b[201~  ')).toBe('Ehm, Kumiba[201~');
  });

  it('keeps filler substrings inside identifiers and domain-like tokens', () => {
    expect(process('hmming album umbilical foo_hmm_bar eee.com hmm/path', { languages: AUTO, removeFillerWords: true }))
      .toBe('hmming album umbilical foo_hmm_bar eee.com hmm/path');
  });

  it('uses the union of the lists of the selected languages and the auto list only in automatic mode', () => {
    expect(process('ehm eee um uh hmm', { languages: only('en'), removeFillerWords: true })).toBe('ehm eee');
    expect(process('ehm eee um uh hmm', { languages: only('sk'), removeFillerWords: true })).toBe('um uh');
    expect(process('ehm eee um uh hmm', { languages: only('cs'), removeFillerWords: true })).toBe('um uh');
    expect(process('ehm eee um uh hmm', { languages: only('sk', 'cs'), removeFillerWords: true })).toBe('um uh');
    expect(process('ehm eee um uh hmm', { languages: only('sk', 'en'), removeFillerWords: true })).toBe('');
    expect(process('ehm eee um uh hmm', { languages: only('sk', 'de'), removeFillerWords: true })).toBe('um uh');
    expect(process('ehm eee um uh hmm', { languages: { mode: 'auto', selected: ['en'] }, removeFillerWords: true })).toBe('');
  });

  it('keeps words of a language without its own filler list', () => {
    expect(process('Ich komme um acht Uhr.', { languages: only('de'), removeFillerWords: true })).toBe('Ich komme um acht Uhr.');
    expect(process('Ich komme um acht Uhr.', { languages: AUTO, removeFillerWords: true })).toBe('Ich komme acht Uhr.');
  });

  it.each([
    ['sk', only('sk'), 'Ehm, eee; HMM!'], ['en', only('en'), 'UM, uh; HMM!'], ['cs', only('cs'), 'Ehm, eee; HMM!'], ['auto', AUTO, 'Ehm, eee; HMM! um uh.'],
  ] as const)('removes only whole hesitation tokens in %s', (_name, languages, fillers) => {
    expect(process(`${fillers} Dobrý deň, like well ako no hummus album.`, { languages, removeFillerWords: true }))
      .toBe('Dobrý deň, like well ako no hummus album.');
    expect(process(fillers, { languages, removeFillerWords: true })).toBe('');
    expect(process('Ahoj, hmm, svet!', { languages, removeFillerWords: true })).toBe('Ahoj, svet!');
  });
});
