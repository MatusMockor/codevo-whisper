import { LANGUAGE_SETS_MIN_VERSION } from '@codevo-whisper/protocol';
import { describe, expect, it } from 'vitest';
import { SERVER_VERSION } from '../src/version';

function parts(version: string): number[] {
  return version.split('.').map(Number);
}

function compareVersions(left: string, right: string): number {
  const [a, b] = [parts(left), parts(right)];
  const index = a.findIndex((part, position) => part !== b[position]);
  return index === -1 ? 0 : Math.sign((a[index] ?? 0) - (b[index] ?? 0));
}

describe('server version', () => {
  it('is a plain major.minor.patch version', () => {
    expect(SERVER_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('is at least the version that introduced dictation language sets', () => {
    expect(LANGUAGE_SETS_MIN_VERSION).toBe('0.3.0');
    expect(compareVersions(SERVER_VERSION, LANGUAGE_SETS_MIN_VERSION)).toBeGreaterThanOrEqual(0);
  });

  it('compares versions numerically', () => {
    expect(compareVersions('0.10.0', '0.3.0')).toBe(1);
    expect(compareVersions('0.2.9', '0.3.0')).toBe(-1);
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0);
  });
});
