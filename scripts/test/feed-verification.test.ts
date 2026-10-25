import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { verifyFeed } from '../release/feed-verification.ts';
import { serializeMacManifest, type FeedFile, type MacManifest } from '../release/mac-manifest.ts';

const ARM64_ZIP = 'codevo-whisper-1.2.0-arm64-mac.zip';
const X64_ZIP = 'codevo-whisper-1.2.0-x64-mac.zip';

let feedDir = '';

const sha512 = (content: string): string => createHash('sha512').update(content).digest('base64');

function asset(url: string, content: string): FeedFile {
  writeFileSync(join(feedDir, url), content);
  return { url, sha512: sha512(content), size: Buffer.byteLength(content) };
}

function writeManifest(files: FeedFile[], primary: FeedFile | undefined = files[0]): string {
  const manifest: MacManifest = { version: '1.2.0', files, ...(primary === undefined ? {} : { path: primary.url, sha512: primary.sha512 }) };
  const file = join(feedDir, 'latest-mac.yml');
  writeFileSync(file, serializeMacManifest(manifest));
  return file;
}

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
});
