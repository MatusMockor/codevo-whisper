import { describe, expect, it } from 'vitest';
import { editDistance } from '../../src/dedup/edit-distance';

describe('editDistance', () => {
  it('counts one deletion for an inflected form', () => {
    expect(editDistance('zahodíme', 'zahodím')).toBe(1);
  });

  it('handles empty strings and identical words', () => {
    expect(editDistance('', 'abc')).toBe(3);
    expect(editDistance('segment', 'segment')).toBe(0);
  });

  it('counts substitutions, insertions and deletions', () => {
    expect(editDistance('kitten', 'sitting')).toBe(3);
  });
});
