import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { serializeUpdateManifest, type FeedFile } from '../release/update-manifest.ts';

const script = join(import.meta.dirname, '..', 'release', 'assemble-linux-feed.sh');

const ARCHS = {
  x64: { manifest: 'latest-linux.yml', appImage: 'codevo-whisper-1.2.0-x86_64-linux.AppImage', deb: 'codevo-whisper-1.2.0-amd64-linux.deb' },
  arm64: { manifest: 'latest-linux-arm64.yml', appImage: 'codevo-whisper-1.2.0-arm64-linux.AppImage', deb: 'codevo-whisper-1.2.0-arm64-linux.deb' },
} as const;

type Arch = keyof typeof ARCHS;

let workDir = '';
let artifacts = '';
let feed = '';

function writePackage(dir: string, name: string): FeedFile {
  const content = `${name} content`;
  writeFileSync(join(dir, name), content);
  return { url: name, sha512: createHash('sha512').update(content).digest('base64'), size: Buffer.byteLength(content) };
}

const sumLine = (name: string): string => `${createHash('sha256').update(`${name} content`).digest('hex')}  ${name}\n`;

function writeArtifact(arch: Arch, version = '1.2.0'): string {
  const names = ARCHS[arch];
  const dir = join(artifacts, `linux-${arch}`);
  mkdirSync(dir, { recursive: true });
  const appImage = { ...writePackage(dir, names.appImage), blockMapSize: 7 };
  const deb = writePackage(dir, names.deb);
  writeFileSync(join(dir, names.manifest), serializeUpdateManifest({ version, files: [appImage, deb], path: appImage.url, sha512: appImage.sha512, releaseDate: '2026-10-30T10:00:00.000Z' }));
  writeFileSync(join(dir, `SHA256SUMS-linux-${arch}`), sumLine(names.appImage) + sumLine(names.deb));
  return dir;
}

const assemble = (version = '1.2.0') =>
  spawnSync(script, [artifacts, feed, version], { encoding: 'utf8', env: { PATH: process.env['PATH'] ?? '', HOME: workDir } });

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), 'cw-linux-feed-'));
  artifacts = join(workDir, 'artifacts');
  feed = join(workDir, 'feed');
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

describe('assemble-linux-feed.sh', () => {
  it('copies packages, manifests and checksums of both architectures into the feed', () => {
    writeArtifact('x64');
    writeArtifact('arm64');

    const result = assemble();

    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(readdirSync(feed).sort()).toEqual(
      [
        ...Object.values(ARCHS).flatMap((names) => [names.manifest, names.appImage, names.deb]),
        'SHA256SUMS-linux-x64',
        'SHA256SUMS-linux-arm64',
      ].sort(),
    );
  });

  it('fails without the arm64 build', () => {
    writeArtifact('x64');

    const result = assemble();

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('linux-arm64/latest-linux-arm64.yml');
  });

  it('fails when the manifest has another version', () => {
    writeArtifact('x64');
    writeArtifact('arm64', '1.1.0');

    const result = assemble();

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('manifest version 1.1.0 != release version 1.2.0');
  });

  it('fails when a package is not listed in the checksums', () => {
    writeArtifact('x64');
    const dir = writeArtifact('arm64');
    writeFileSync(join(dir, 'SHA256SUMS-linux-arm64'), sumLine(ARCHS.arm64.appImage));

    const result = assemble();

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`${ARCHS.arm64.deb} is not listed in SHA256SUMS-linux-arm64`);
  });

  it('fails when a checksum does not match its package', () => {
    writeArtifact('x64');
    const dir = writeArtifact('arm64');
    appendFileSync(join(dir, 'SHA256SUMS-linux-arm64'), `${'0'.repeat(64)}  ${ARCHS.arm64.deb}\n`);

    const result = assemble();

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`${ARCHS.arm64.deb}: sha256 mismatch`);
  });

  it('refuses a package in the artifact that its manifest does not list', () => {
    writeArtifact('x64');
    const dir = writeArtifact('arm64');
    const stale = 'codevo-whisper-1.1.0-arm64-linux.deb';
    writeFileSync(join(dir, stale), `${stale} content`);
    appendFileSync(join(dir, 'SHA256SUMS-linux-arm64'), sumLine(stale));

    const result = assemble();

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`${stale} is in linux-arm64 but not listed in latest-linux-arm64.yml`);
    expect(existsSync(join(feed, stale))).toBe(false);
  });

  it('fails when the manifest does not list the deb', () => {
    writeArtifact('x64');
    const dir = writeArtifact('arm64');
    const appImage = writePackage(dir, ARCHS.arm64.appImage);
    writeFileSync(join(dir, ARCHS.arm64.manifest), serializeUpdateManifest({ version: '1.2.0', files: [appImage] }));
    rmSync(join(dir, ARCHS.arm64.deb));
    writeFileSync(join(dir, 'SHA256SUMS-linux-arm64'), sumLine(ARCHS.arm64.appImage));

    const result = assemble();

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`missing ${join(dir, '*.deb')}`);
  });

  it('fails when the manifest lists a deb the artifact does not contain', () => {
    writeArtifact('x64');
    const dir = writeArtifact('arm64');
    rmSync(join(dir, ARCHS.arm64.deb));
    writeFileSync(join(dir, 'SHA256SUMS-linux-arm64'), sumLine(ARCHS.arm64.appImage));
    writeFileSync(join(dir, 'other-arm64.deb'), 'other');
    appendFileSync(join(dir, 'SHA256SUMS-linux-arm64'), `${createHash('sha256').update('other').digest('hex')}  other-arm64.deb\n`);

    const result = assemble();

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('other-arm64.deb is in linux-arm64 but not listed in latest-linux-arm64.yml');
  });

  it('refuses to overwrite a file already in the feed', () => {
    writeArtifact('x64');
    writeArtifact('arm64');
    mkdirSync(feed);
    writeFileSync(join(feed, ARCHS.x64.deb), 'other deb');

    const result = assemble();

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('refusing to overwrite');
    expect(existsSync(join(feed, ARCHS.arm64.manifest))).toBe(false);
  });
});
