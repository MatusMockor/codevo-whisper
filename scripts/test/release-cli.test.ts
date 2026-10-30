import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseUpdateManifest, serializeUpdateManifest, type FeedFile } from '../release/update-manifest.ts';

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
  writeFileSync(manifestFile, serializeUpdateManifest({ version: '1.2.0', files: [file], path: file.url, sha512: file.sha512, releaseDate: '2026-10-25T10:00:00.000Z' }));
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
    expect(parseUpdateManifest(readFileSync(out, 'utf8'), out).files).toHaveLength(2);
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

describe('verify-feed.ts for Linux manifests', () => {
  it('accepts the arm64 manifest and rejects an unknown manifest name', () => {
    const appImage = asset('codevo-whisper-1.2.0-arm64-linux.AppImage', 'arm64 appimage');
    const deb = asset('codevo-whisper-1.2.0-arm64-linux.deb', 'arm64 deb');
    const manifest = serializeUpdateManifest({ version: '1.2.0', files: [appImage, deb], path: appImage.url, sha512: appImage.sha512 });
    writeFileSync(join(workDir, 'latest-linux-arm64.yml'), manifest);
    writeFileSync(join(workDir, 'latest-linux-armv7l.yml'), manifest);

    const valid = run('verify-feed.ts', [join(workDir, 'latest-linux-arm64.yml'), '1.2.0']);
    const unknown = run('verify-feed.ts', [join(workDir, 'latest-linux-armv7l.yml'), '1.2.0']);

    expect(valid.status).toBe(0);
    expect(valid.stdout).toContain('feed 1.2.0 valid: 2 files, archs arm64');
    expect(unknown.status).toBe(1);
    expect(unknown.stderr).toContain('unknown update manifest');
  });
});

describe('manifest-urls.ts', () => {
  it('prints every listed url and fails on a manifest without files', () => {
    const manifest = join(workDir, 'latest-linux.yml');
    writeFileSync(manifest, serializeUpdateManifest({ version: '1.2.0', files: [{ url: 'a.AppImage', sha512: 'x', size: 1 }, { url: 'b.deb', sha512: 'y', size: 2 }] }));
    writeFileSync(join(workDir, 'empty.yml'), 'version: 1.2.0\nfiles: []\n');

    const listed = run('manifest-urls.ts', [manifest]);
    const empty = run('manifest-urls.ts', [join(workDir, 'empty.yml')]);

    expect(listed.status).toBe(0);
    expect(listed.stdout).toBe('a.AppImage\nb.deb\n');
    expect(empty.status).toBe(1);
    expect(empty.stderr).toContain('no files');
  });
});

describe('verify-checksums.ts', () => {
  it('passes for matching checksums and fails for a tampered package', () => {
    writeFileSync(join(workDir, 'app.AppImage'), 'appimage');
    writeFileSync(join(workDir, 'SHA256SUMS-linux-x64'), `${createHash('sha256').update('appimage').digest('hex')}  app.AppImage\n`);

    const valid = run('verify-checksums.ts', [join(workDir, 'SHA256SUMS-linux-x64')]);
    writeFileSync(join(workDir, 'app.AppImage'), 'appimagE');
    const tampered = run('verify-checksums.ts', [join(workDir, 'SHA256SUMS-linux-x64')]);

    expect(valid.status).toBe(0);
    expect(valid.stdout).toContain('valid: 1 files');
    expect(tampered.status).toBe(1);
    expect(tampered.stderr).toContain('app.AppImage: sha256 mismatch');
  });

  it('exits with 2 without arguments', () => {
    expect(run('verify-checksums.ts', []).status).toBe(2);
  });
});

describe('verify-release-assets.ts', () => {
  it('passes for identical directories and fails for a tampered asset', () => {
    const local = join(workDir, 'local');
    const remote = join(workDir, 'remote');
    mkdirSync(local);
    mkdirSync(remote);
    writeFileSync(join(local, 'latest-mac.yml'), 'version: 1.2.0');
    writeFileSync(join(remote, 'latest-mac.yml'), 'version: 1.2.0');

    const same = run('verify-release-assets.ts', [local, remote]);
    writeFileSync(join(remote, 'latest-mac.yml'), 'version: 6.6.6');
    const tampered = run('verify-release-assets.ts', [local, remote]);

    expect(same.status).toBe(0);
    expect(tampered.status).toBe(1);
    expect(tampered.stderr).toContain('latest-mac.yml: sha256 differs');
  });
});

describe('notary-state-cli.ts', () => {
  it('records a submission and reports the phase and id', () => {
    writeFileSync(join(workDir, 'app.zip'), 'signed app');

    expect(run('notary-state-cli.ts', ['phase', workDir]).stdout.trim()).toBe('none');
    expect(run('notary-state-cli.ts', ['record', workDir, 'app', 'abc-123', 'app.zip']).status).toBe(0);
    expect(run('notary-state-cli.ts', ['phase', workDir]).stdout.trim()).toBe('app-submitted');
    expect(run('notary-state-cli.ts', ['submission', workDir, 'app']).stdout.trim()).toBe('abc-123');
  });

  it('fails when the saved app no longer matches', () => {
    writeFileSync(join(workDir, 'app.zip'), 'signed app');
    run('notary-state-cli.ts', ['record', workDir, 'app', 'abc-123', 'app.zip']);
    writeFileSync(join(workDir, 'app.zip'), 'rebuilt app');
    const result = run('notary-state-cli.ts', ['phase', workDir]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('refusing to resume');
  });
});
