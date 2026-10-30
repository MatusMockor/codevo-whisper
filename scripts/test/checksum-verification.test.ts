import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { verifyChecksums } from '../release/checksum-verification.ts';

const APPIMAGE = 'codevo-whisper-1.2.0-x86_64-linux.AppImage';
const DEB = 'codevo-whisper-1.2.0-amd64-linux.deb';

let dir = '';

const sha256 = (content: string): string => createHash('sha256').update(content).digest('hex');

function writeSums(lines: string[]): string {
  const file = join(dir, 'SHA256SUMS-linux-x64');
  writeFileSync(file, lines.map((line) => `${line}\n`).join(''));
  return file;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cw-sums-'));
  writeFileSync(join(dir, APPIMAGE), 'appimage');
  writeFileSync(join(dir, DEB), 'deb');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('verifyChecksums', () => {
  it('accepts sha256sum output in text and binary mode', async () => {
    const report = await verifyChecksums(writeSums([`${sha256('appimage')}  ${APPIMAGE}`, `${sha256('deb')} *${DEB}`]));

    expect(report.problems).toEqual([]);
    expect(report.entries.map((entry) => entry.name)).toEqual([APPIMAGE, DEB]);
  });

  it('reports a file whose content changed', async () => {
    const file = writeSums([`${sha256('appimage')}  ${APPIMAGE}`]);
    writeFileSync(join(dir, APPIMAGE), 'appimagE');

    expect((await verifyChecksums(file)).problems).toEqual([`${APPIMAGE}: sha256 mismatch`]);
  });

  it('reports a listed file that is missing', async () => {
    const report = await verifyChecksums(writeSums([`${sha256('gone')}  gone.deb`]));

    expect(report.problems).toEqual(['gone.deb: missing']);
  });

  it('rejects names that are not plain file names', async () => {
    const report = await verifyChecksums(writeSums([`${sha256('appimage')}  ./${APPIMAGE}`, `${sha256('x')}  ../secret`]));

    expect(report.problems).toEqual([`./${APPIMAGE}: not a plain file name`, '../secret: not a plain file name']);
  });

  it('rejects malformed lines and an empty file', async () => {
    expect((await verifyChecksums(writeSums(['not a checksum']))).problems).toEqual(['not a sha256sum line: "not a checksum"']);
    expect((await verifyChecksums(writeSums([]))).problems).toEqual(['no checksums']);
  });
});
