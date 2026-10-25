import { describe, expect, it } from 'vitest';
import { removeBoundaryDuplicates } from '../../src/dedup/resolve-boundary';

describe('removeBoundaryDuplicates', () => {
  it('removes an exact overlap ignoring case and punctuation', () => {
    expect(removeBoundaryDuplicates('Potom ho zahodíme.', 'ho zahodíme, a pokračujeme', 4)).toBe('a pokračujeme');
  });

  it('removes an inflected overlap', () => {
    expect(removeBoundaryDuplicates('Ak to neprejde, a potom to zahodíme.', 'zahodím. Potom spravíme nový.', 4)).toBe('Potom spravíme nový.');
  });

  it('keeps text when nothing overlaps', () => {
    expect(removeBoundaryDuplicates('Prvá veta skončila.', 'Druhá veta začína.', 4)).toBe('Druhá veta začína.');
  });

  it('respects maxOverlapWords', () => {
    expect(removeBoundaryDuplicates('jeden dva tri', 'jeden dva tri štyri', 2)).toBe('jeden dva tri štyri');
    expect(removeBoundaryDuplicates('jeden dva tri', 'jeden dva tri štyri', 3)).toBe('štyri');
  });

  it('does not remove anything when maxOverlapWords is 0', () => {
    expect(removeBoundaryDuplicates('a potom', ' potom ďalej ', 0)).toBe('potom ďalej');
  });

  it('prefers the longest overlap', () => {
    expect(removeBoundaryDuplicates('to je to je', 'to je to je hotové', 4)).toBe('hotové');
  });

  it('skips punctuation-only tokens inside and right after the duplicate prefix', () => {
    expect(removeBoundaryDuplicates('kód je hotový', 'je - hotový , teraz testy', 4)).toBe('teraz testy');
  });

  it('returns an empty string when the next text is only the overlap', () => {
    expect(removeBoundaryDuplicates('a potom zahodíme', 'zahodím.', 4)).toBe('');
  });

  it('a single-word overlap only matches when the words differ in the ending', () => {
    expect(removeBoundaryDuplicates('all right', 'night falls', 4)).toBe('night falls');
    expect(removeBoundaryDuplicates('potom to zahodíme.', 'zahodím a hotovo', 4)).toBe('a hotovo');
  });

  it('keeps the next text when the previous one is empty', () => {
    expect(removeBoundaryDuplicates('', 'nový text', 4)).toBe('nový text');
  });
});
