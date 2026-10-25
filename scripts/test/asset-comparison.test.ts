import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { compareAssetDirs } from '../release/asset-comparison.ts';

let expected = '';
let actual = '';

function write(dir: string, files: Record<string, string>): void {
  Object.entries(files).forEach(([name, content]) => writeFileSync(join(dir, name), content));
}

const FEED = { 'a-arm64-mac.zip': 'arm zip', 'a-arm64-mac.zip.blockmap': 'arm map', 'a-x64-mac.dmg': 'x dmg', 'latest-mac.yml': 'version: 1.2.0' };

beforeEach(() => {
  expected = mkdtempSync(join(tmpdir(), 'cw-expected-'));
  actual = mkdtempSync(join(tmpdir(), 'cw-actual-'));
});

afterEach(() => {
  rmSync(expected, { recursive: true, force: true });
  rmSync(actual, { recursive: true, force: true });
});

describe('compareAssetDirs', () => {
  it('accepts identical asset sets', async () => {
    write(expected, FEED);
    write(actual, FEED);

    expect(await compareAssetDirs(expected, actual)).toEqual([]);
  });

  it('reports an asset that differs in content', async () => {
    write(expected, FEED);
    write(actual, { ...FEED, 'a-x64-mac.dmg': 'x dmg tampered' });

    expect(await compareAssetDirs(expected, actual)).toEqual(['a-x64-mac.dmg: sha256 differs']);
  });

  it('reports a missing and an unexpected asset', async () => {
    write(expected, FEED);
    const rest = Object.fromEntries(Object.entries(FEED).filter(([name]) => name !== 'a-arm64-mac.zip.blockmap'));
    write(actual, { ...rest, 'extra.txt': 'x' });

    expect(await compareAssetDirs(expected, actual)).toEqual(['a-arm64-mac.zip.blockmap: missing from the release', 'extra.txt: not in the local feed']);
  });

  it('reports an empty release', async () => {
    write(expected, FEED);

    expect(await compareAssetDirs(expected, actual)).toHaveLength(4);
  });
});
