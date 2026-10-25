import { createHash } from 'node:crypto';
import { chmod, mkdir, mkdtemp, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { verifyDownload } from '../src/main/updates/verify-download';

const BODY = 'PK fake update zip';

let scratch: string;
let cacheDir: string;
let pendingDir: string;
let file: string;

function sha512(body: string): string {
  return createHash('sha512').update(body).digest('base64');
}

beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), 'cw-verify-download-'));
  cacheDir = join(scratch, 'codevo-updater');
  pendingDir = join(cacheDir, 'pending');
  await mkdir(pendingDir, { recursive: true, mode: 0o755 });
  file = join(pendingDir, 'codevo-whisper-1.2.0-arm64-mac.zip');
  await writeFile(file, BODY);
});

afterEach(async () => {
  await rm(scratch, { recursive: true, force: true });
});

async function mode(path: string): Promise<number> {
  return (await stat(path)).mode & 0o777;
}

describe('verifyDownload', () => {
  it('accepts the file with the expected sha512 and makes the cache private', async () => {
    await chmod(cacheDir, 0o755);

    await verifyDownload(file, sha512(BODY));

    expect(await mode(cacheDir)).toBe(0o700);
    expect(await mode(pendingDir)).toBe(0o700);
  });

  it('rejects a file that changed after the download', async () => {
    await writeFile(file, 'PK tampered');

    await expect(verifyDownload(file, sha512(BODY))).rejects.toThrow('The downloaded update does not match its sha512');
  });

  it('rejects a symlinked update file', async () => {
    const elsewhere = join(scratch, 'elsewhere.zip');
    await writeFile(elsewhere, BODY);
    await rm(file);
    await symlink(elsewhere, file);

    await expect(verifyDownload(file, sha512(BODY))).rejects.toThrow('The downloaded update is not a regular file');
  });

  it('rejects a symlinked cache directory', async () => {
    const real = join(scratch, 'real-pending');
    await mkdir(real);
    await writeFile(join(real, 'u.zip'), BODY);
    await rm(pendingDir, { recursive: true });
    await symlink(real, pendingDir);

    await expect(verifyDownload(join(pendingDir, 'u.zip'), sha512(BODY))).rejects.toThrow('The update cache is not a private directory');
  });

  it('rejects a missing file', async () => {
    await rm(file);

    await expect(verifyDownload(file, sha512(BODY))).rejects.toThrow();
  });
});
