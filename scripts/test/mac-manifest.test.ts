import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FeedError } from '../release/feed-error.ts';
import { mergeMacManifests, parseMacManifest, serializeMacManifest, type MacManifest } from '../release/mac-manifest.ts';

const fixture = (name: string): MacManifest =>
  parseMacManifest(readFileSync(join(import.meta.dirname, 'fixtures', name), 'utf8'), name);

describe('parseMacManifest', () => {
  it('reads an electron-builder manifest', () => {
    const manifest = fixture('latest-mac-arm64.yml');

    expect(manifest.version).toBe('1.2.0');
    expect(manifest.files).toHaveLength(1);
    expect(manifest.files[0]).toMatchObject({ url: 'codevo-whisper-1.2.0-arm64-mac.zip', size: 101, blockMapSize: 11 });
  });

  it('rejects an entry without an integer size', () => {
    expect(() => fixture('latest-mac-missing-size.yml')).toThrow(FeedError);
  });

  it('rejects a manifest without files', () => {
    expect(() => parseMacManifest('version: 1.2.0\nfiles: []\n', 'empty.yml')).toThrow(/empty\.yml/);
  });

  it('rejects a document that is not a manifest', () => {
    expect(() => parseMacManifest('just text', 'text.yml')).toThrow(FeedError);
  });
});

describe('mergeMacManifests', () => {
  it('lists the zips of both architectures', () => {
    const merged = mergeMacManifests([fixture('latest-mac-arm64.yml'), fixture('latest-mac-x64.yml')]);

    expect(merged.version).toBe('1.2.0');
    expect(merged.files.map((file) => file.url)).toEqual(['codevo-whisper-1.2.0-arm64-mac.zip', 'codevo-whisper-1.2.0-x64-mac.zip']);
  });

  it('points the legacy path and sha512 to the x64 zip', () => {
    const x64 = fixture('latest-mac-x64.yml');
    const merged = mergeMacManifests([fixture('latest-mac-arm64.yml'), x64]);

    expect(merged.path).toBe('codevo-whisper-1.2.0-x64-mac.zip');
    expect(merged.sha512).toBe(x64.files[0]?.sha512);
  });

  it('keeps the latest release date', () => {
    const merged = mergeMacManifests([fixture('latest-mac-x64.yml'), fixture('latest-mac-arm64.yml')]);

    expect(merged.releaseDate).toBe('2026-10-25T11:00:00.000Z');
  });

  it('keeps extra entry fields such as blockMapSize', () => {
    const merged = mergeMacManifests([fixture('latest-mac-arm64.yml'), fixture('latest-mac-x64.yml')]);

    expect(merged.files.map((file) => file['blockMapSize'])).toEqual([11, 12]);
  });

  it('de-duplicates entries by url', () => {
    const arm64 = fixture('latest-mac-arm64.yml');
    const merged = mergeMacManifests([arm64, arm64, fixture('latest-mac-x64.yml')]);

    expect(merged.files).toHaveLength(2);
  });

  it('keeps dmg entries next to the zips', () => {
    const merged = mergeMacManifests([fixture('latest-mac-arm64.yml'), fixture('latest-mac-x64.yml'), fixture('latest-mac-dmg-only.yml')]);

    expect(merged.files.map((file) => file.url)).toContain('codevo-whisper-1.2.0-x64-mac.dmg');
    expect(merged.path).toBe('codevo-whisper-1.2.0-x64-mac.zip');
  });

  it('refuses mismatched versions', () => {
    expect(() => mergeMacManifests([fixture('latest-mac-arm64.yml'), fixture('latest-mac-other-version.yml')])).toThrow(/version mismatch/);
  });

  it('refuses a merge without any zip', () => {
    const dmg = fixture('latest-mac-dmg-only.yml');

    expect(() => mergeMacManifests([dmg, dmg])).toThrow(/zip/);
  });

  it('refuses a single manifest', () => {
    expect(() => mergeMacManifests([fixture('latest-mac-arm64.yml')])).toThrow(/at least two/);
  });

  it('serializes to a manifest that parses back to the same content', () => {
    const merged = mergeMacManifests([fixture('latest-mac-arm64.yml'), fixture('latest-mac-x64.yml')]);

    expect(parseMacManifest(serializeMacManifest(merged), 'merged.yml')).toEqual(merged);
  });
});
