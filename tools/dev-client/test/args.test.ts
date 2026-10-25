import { describe, expect, it } from 'vitest';
import { parseArgs } from '../src/args';

describe('parseArgs', () => {
  it('reads --live as a flag without a value anywhere on the line', () => {
    const before = parseArgs(['transcribe', '--live', 'sample.wav', '--language', 'cs']);
    const after = parseArgs(['transcribe', 'sample.wav', '--live']);

    expect(before.positional).toEqual(['transcribe', 'sample.wav']);
    expect(before.flags.has('live')).toBe(true);
    expect(before.options.get('language')).toBe('cs');
    expect(after.flags.has('live')).toBe(true);
  });

  it('has no live flag when it is not given', () => {
    expect(parseArgs(['transcribe', 'sample.wav']).flags.has('live')).toBe(false);
  });
});
