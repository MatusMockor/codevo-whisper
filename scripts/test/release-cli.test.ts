import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseMacManifest, serializeMacManifest, type FeedFile } from '../release/mac-manifest.ts';

const releaseDir = join(import.meta.dirname, '..', 'release');
const fixtures = join(import.meta.dirname, 'fixtures');

let workDir = '';

const run = (script: string, args: string[]) => spawnSync(process.execPath, [join(releaseDir, script), ...args], { encoding: 'utf8' });

function asset(url: string, content: string): FeedFile {
  writeFileSync(join(workDir, url), content);
  return { url, sha512: createHash('sha512').update(content).digest('base64'), size: Buffer.byteLength(content) };
}

function perArchManifest(arch: string, content: string): string {
  const file = asset(`codevo-whisper-1.2.0-${arch}-mac.zip`, content);
  const manifestFile = join(workDir, `latest-mac-${arch}.yml`);
  writeFileSync(manifestFile, serializeMacManifest({ version: '1.2.0', files: [file], path: file.url, sha512: file.sha512, releaseDate: '2026-10-25T10:00:00.000Z' }));
  return manifestFile;
}

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), 'cw-release-cli-'));
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

describe('merge-latest-mac.ts', () => {
  it('writes the merged manifest', () => {
    copyFileSync(join(fixtures, 'latest-mac-arm64.yml'), join(workDir, 'arm64.yml'));
    const out = join(workDir, 'feed', 'latest-mac.yml');

    const result = run('merge-latest-mac.ts', [out, join(workDir, 'arm64.yml'), join(fixtures, 'latest-mac-x64.yml')]);

    expect(result.status).toBe(0);
    expect(parseMacManifest(readFileSync(out, 'utf8'), out).files).toHaveLength(2);
  });

  it('exits with 1 on mismatched versions', () => {
    const result = run('merge-latest-mac.ts', [join(workDir, 'out.yml'), join(fixtures, 'latest-mac-arm64.yml'), join(fixtures, 'latest-mac-other-version.yml')]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('version mismatch');
  });

  it('exits with 2 without enough arguments', () => {
    expect(run('merge-latest-mac.ts', [join(workDir, 'out.yml')]).status).toBe(2);
  });
});

describe('verify-feed.ts', () => {
  it('accepts a merged feed and rejects a tampered one', () => {
    const out = join(workDir, 'latest-mac.yml');
    expect(run('merge-latest-mac.ts', [out, perArchManifest('arm64', 'arm64 zip'), perArchManifest('x64', 'x64 zip')]).status).toBe(0);

    const valid = run('verify-feed.ts', [out]);
    writeFileSync(join(workDir, 'codevo-whisper-1.2.0-x64-mac.zip'), 'x64 zap');
    const tampered = run('verify-feed.ts', [out]);

    expect(valid.status).toBe(0);
    expect(valid.stdout).toContain('feed 1.2.0 valid');
    expect(tampered.status).toBe(1);
    expect(tampered.stderr).toContain('sha512 mismatch');
  });
});
