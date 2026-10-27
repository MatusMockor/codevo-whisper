import { describe, expect, it } from 'vitest';
import { compareVersions, parseVersion, type Version } from '../src/main/updates/version-order';

function version(text: string): Version {
  const parsed = parseVersion(text);
  expect(parsed).not.toBeNull();
  return parsed ?? { core: [], prerelease: [] };
}

function order(a: string, b: string): number {
  return Math.sign(compareVersions(version(a), version(b)));
}

describe('version order', () => {
  it('parses semantic versions and rejects everything else', () => {
    expect(parseVersion('1.2.3')).toEqual({ core: [1, 2, 3], prerelease: [] });
    expect(parseVersion('1.2.3-beta.11')).toEqual({ core: [1, 2, 3], prerelease: ['beta', '11'] });
    expect(parseVersion('v1.2.3')).toBeNull();
    expect(parseVersion('1.2')).toBeNull();
    expect(parseVersion('01.2.3')).toBeNull();
    expect(parseVersion('1.2.3-')).toBeNull();
    expect(parseVersion('')).toBeNull();
  });

  it('orders the numeric parts numerically', () => {
    expect(order('1.2.3', '1.2.3')).toBe(0);
    expect(order('1.10.0', '1.9.9')).toBe(1);
    expect(order('0.9.0', '1.0.0')).toBe(-1);
    expect(order('2.0.0', '1.99.99')).toBe(1);
  });

  it('orders prereleases before their release and by their identifiers', () => {
    expect(order('1.0.0-beta', '1.0.0')).toBe(-1);
    expect(order('1.0.0', '1.0.0-rc.1')).toBe(1);
    expect(order('1.0.0-alpha', '1.0.0-alpha.1')).toBe(-1);
    expect(order('1.0.0-alpha.1', '1.0.0-alpha.beta')).toBe(-1);
    expect(order('1.0.0-beta.2', '1.0.0-beta.11')).toBe(-1);
    expect(order('1.0.0-rc.1', '1.0.0-beta.11')).toBe(1);
  });
});
