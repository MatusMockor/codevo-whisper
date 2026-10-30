import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FeedError } from '../release/feed-error.ts';
import { verifyFeed } from '../release/feed-verification.ts';
import { serializeUpdateManifest, type FeedFile, type UpdateManifest } from '../release/update-manifest.ts';

const ARM64_ZIP = 'codevo-whisper-1.2.0-arm64-mac.zip';
const X64_ZIP = 'codevo-whisper-1.2.0-x64-mac.zip';
const X64_APPIMAGE = 'codevo-whisper-1.2.0-x86_64-linux.AppImage';
const X64_DEB = 'codevo-whisper-1.2.0-amd64-linux.deb';
const ARM64_APPIMAGE = 'codevo-whisper-1.2.0-arm64-linux.AppImage';
const ARM64_DEB = 'codevo-whisper-1.2.0-arm64-linux.deb';

let feedDir = '';

const sha512 = (content: string): string => createHash('sha512').update(content).digest('base64');

function asset(url: string, content: string): FeedFile {
  writeFileSync(join(feedDir, url), content);
  return { url, sha512: sha512(content), size: Buffer.byteLength(content) };
}

function writeNamedManifest(name: string, files: FeedFile[], primary: FeedFile | undefined = files[0]): string {
  const manifest: UpdateManifest = { version: '1.2.0', files, ...(primary === undefined ? {} : { path: primary.url, sha512: primary.sha512 }) };
  const file = join(feedDir, name);
  writeFileSync(file, serializeUpdateManifest(manifest));
  return file;
}

const writeManifest = (files: FeedFile[], primary: FeedFile | undefined = files[0]): string => writeNamedManifest('latest-mac.yml', files, primary);

beforeEach(() => {
  feedDir = mkdtempSync(join(tmpdir(), 'cw-feed-'));
});

afterEach(() => {
  rmSync(feedDir, { recursive: true, force: true });
});

describe('verifyFeed', () => {
  it('accepts a feed with matching zips for both architectures', async () => {
    const x64 = asset(X64_ZIP, 'x64 zip');
    const report = await verifyFeed(writeManifest([asset(ARM64_ZIP, 'arm64 zip'), x64], x64));

    expect(report.problems).toEqual([]);
    expect(report.archs).toEqual(['arm64', 'x64']);
  });

  it('reports a file with a wrong sha512', async () => {
    const arm64 = asset(ARM64_ZIP, 'arm64 zip');
    const x64 = asset(X64_ZIP, 'x64 zip');
    const file = writeManifest([arm64, x64], x64);
    writeFileSync(join(feedDir, ARM64_ZIP), 'arm64 zap');

    const report = await verifyFeed(file);

    expect(report.problems).toEqual([`${ARM64_ZIP}: sha512 mismatch`]);
  });

  it('reports a file with a wrong size', async () => {
    const x64 = asset(X64_ZIP, 'x64 zip');
    const report = await verifyFeed(writeManifest([{ ...asset(ARM64_ZIP, 'arm64 zip'), size: 3 }, x64], x64));

    expect(report.problems).toEqual([`${ARM64_ZIP}: size 9 != 3`]);
  });

  it('reports a missing file', async () => {
    const x64 = asset(X64_ZIP, 'x64 zip');
    const report = await verifyFeed(writeManifest([{ url: ARM64_ZIP, sha512: sha512('gone'), size: 4 }, x64], x64));

    expect(report.problems).toEqual([`${ARM64_ZIP}: missing`]);
  });

  it('requires a zip per architecture', async () => {
    const report = await verifyFeed(writeManifest([asset(ARM64_ZIP, 'arm64 zip')]));

    expect(report.problems).toEqual(['expected zip entries for arm64 and x64, found: arm64']);
  });

  it('does not count an x64 name that contains arm64', async () => {
    const tricky = asset('codevo-whisper-1.2.0-x64-arm64-mac.zip', 'tricky');
    const report = await verifyFeed(writeManifest([asset(ARM64_ZIP, 'arm64 zip'), tricky], tricky));

    expect(report.archs).toEqual(['arm64']);
  });

  it('reports a manifest version other than the release version', async () => {
    const x64 = asset(X64_ZIP, 'x64 zip');
    const report = await verifyFeed(writeManifest([asset(ARM64_ZIP, 'arm64 zip'), x64], x64), '1.3.0');

    expect(report.problems).toEqual(['manifest version 1.2.0 != release version 1.3.0']);
  });

  it('rejects a url that leaves the feed directory', async () => {
    const x64 = asset(X64_ZIP, 'x64 zip');
    const report = await verifyFeed(writeManifest([asset(ARM64_ZIP, 'arm64 zip'), x64, { url: '../secret.zip', sha512: sha512('x'), size: 1 }], x64));

    expect(report.problems).toEqual(['../secret.zip: not a plain file name']);
  });

  it('reports a legacy path that is not one of the files', async () => {
    const arm64 = asset(ARM64_ZIP, 'arm64 zip');
    const x64 = asset(X64_ZIP, 'x64 zip');
    const report = await verifyFeed(writeManifest([arm64, x64], { ...x64, url: 'codevo-whisper-1.1.0-x64-mac.zip' }));

    expect(report.problems).toEqual(['path codevo-whisper-1.1.0-x64-mac.zip does not match a listed file with the same sha512']);
  });

  it('refuses a manifest name it has no rules for', async () => {
    const file = writeNamedManifest('latest.yml', [asset(X64_ZIP, 'x64 zip')]);

    await expect(verifyFeed(file)).rejects.toThrow(FeedError);
    await expect(verifyFeed(file)).rejects.toThrow(/unknown update manifest/);
  });
});

describe('verifyFeed for Linux manifests', () => {
  it('accepts the x64 manifest electron-builder writes for AppImage and deb', async () => {
    const appImage = { ...asset(X64_APPIMAGE, 'x64 appimage'), blockMapSize: 42 };
    const file = writeNamedManifest('latest-linux.yml', [appImage, asset(X64_DEB, 'x64 deb')], appImage);

    const report = await verifyFeed(file, '1.2.0');

    expect(report.problems).toEqual([]);
    expect(report.archs).toEqual(['x64']);
  });

  it('accepts the arm64 manifest with the legacy path on the deb', async () => {
    const deb = asset(ARM64_DEB, 'arm64 deb');
    const file = writeNamedManifest('latest-linux-arm64.yml', [deb, asset(ARM64_APPIMAGE, 'arm64 appimage')], deb);

    const report = await verifyFeed(file, '1.2.0');

    expect(report.problems).toEqual([]);
    expect(report.archs).toEqual(['arm64']);
  });

  it('requires the deb', async () => {
    const report = await verifyFeed(writeNamedManifest('latest-linux.yml', [asset(X64_APPIMAGE, 'x64 appimage')]));

    expect(report.problems).toEqual([`expected one ${X64_DEB} entry, found 0`]);
    expect(report.archs).toEqual([]);
  });

  it('requires the AppImage', async () => {
    const report = await verifyFeed(writeNamedManifest('latest-linux.yml', [asset(X64_DEB, 'x64 deb')]));

    expect(report.problems).toEqual([`expected one ${X64_APPIMAGE} entry, found 0`]);
  });

  it('rejects package names of another version even when the hashes match', async () => {
    const stale = asset('codevo-whisper-1.1.0-x86_64-linux.AppImage', 'old appimage');
    const report = await verifyFeed(writeNamedManifest('latest-linux.yml', [stale, asset(X64_DEB, 'x64 deb')]), '1.2.0');

    expect(report.problems).toEqual([
      'codevo-whisper-1.1.0-x86_64-linux.AppImage: not the x64 AppImage or deb of 1.2.0',
      `expected one ${X64_APPIMAGE} entry, found 0`,
    ]);
  });

  it('rejects an arm64 AppImage in the x64 manifest', async () => {
    const report = await verifyFeed(writeNamedManifest('latest-linux.yml', [asset(ARM64_APPIMAGE, 'arm64 appimage'), asset(X64_DEB, 'x64 deb')]));

    expect(report.problems).toEqual([`${ARM64_APPIMAGE}: not the x64 AppImage or deb of 1.2.0`, `expected one ${X64_APPIMAGE} entry, found 0`]);
    expect(report.archs).toEqual([]);
  });

  it('rejects an x64 AppImage in the arm64 manifest', async () => {
    const report = await verifyFeed(writeNamedManifest('latest-linux-arm64.yml', [asset(X64_APPIMAGE, 'x64 appimage'), asset(ARM64_DEB, 'arm64 deb')]));

    expect(report.problems).toEqual([`${X64_APPIMAGE}: not the arm64 AppImage or deb of 1.2.0`, `expected one ${ARM64_APPIMAGE} entry, found 0`]);
  });

  it('rejects a deb of the other architecture', async () => {
    const report = await verifyFeed(writeNamedManifest('latest-linux-arm64.yml', [asset(ARM64_APPIMAGE, 'arm64 appimage'), asset(X64_DEB, 'x64 deb')]));

    expect(report.problems).toEqual([`${X64_DEB}: not the arm64 AppImage or deb of 1.2.0`, `expected one ${ARM64_DEB} entry, found 0`]);
  });

  it('rejects an AppImage name with an arch token electron-builder uses only for the deb', async () => {
    const amd64AppImage = asset('codevo-whisper-1.2.0-amd64-linux.AppImage', 'x64 appimage');
    const report = await verifyFeed(writeNamedManifest('latest-linux.yml', [amd64AppImage, asset(X64_DEB, 'x64 deb')]));

    expect(report.problems).toEqual([
      'codevo-whisper-1.2.0-amd64-linux.AppImage: not the x64 AppImage or deb of 1.2.0',
      `expected one ${X64_APPIMAGE} entry, found 0`,
    ]);
  });

  it('rejects the same package listed twice', async () => {
    const appImage = asset(X64_APPIMAGE, 'x64 appimage');
    const report = await verifyFeed(writeNamedManifest('latest-linux.yml', [appImage, asset(X64_DEB, 'x64 deb'), appImage]));

    expect(report.problems).toEqual([`expected one ${X64_APPIMAGE} entry, found 2`]);
  });

  it('rejects a mac zip in a Linux manifest', async () => {
    const report = await verifyFeed(writeNamedManifest('latest-linux.yml', [asset(X64_APPIMAGE, 'x64 appimage'), asset(X64_DEB, 'x64 deb'), asset(X64_ZIP, 'x64 zip')]));

    expect(report.problems).toEqual([`${X64_ZIP}: not the x64 AppImage or deb of 1.2.0`]);
  });

  it('reports a version, hash and path problem like the mac feed', async () => {
    const appImage = asset(X64_APPIMAGE, 'x64 appimage');
    const file = writeNamedManifest('latest-linux.yml', [appImage, asset(X64_DEB, 'x64 deb'), { url: `../${X64_DEB}`, sha512: sha512('x'), size: 1 }], appImage);
    writeFileSync(join(feedDir, X64_APPIMAGE), 'x64 appimagE');

    const report = await verifyFeed(file, '1.3.0');

    expect(report.problems).toEqual([
      'manifest version 1.2.0 != release version 1.3.0',
      `${X64_APPIMAGE}: sha512 mismatch`,
      `../${X64_DEB}: not a plain file name`,
      `../${X64_DEB}: not the x64 AppImage or deb of 1.2.0`,
    ]);
  });
});
