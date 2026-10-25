import { createHash } from 'node:crypto';
import { constants, type Stats } from 'node:fs';
import { chmod, lstat, open } from 'node:fs/promises';
import { dirname } from 'node:path';

const PRIVATE_DIR_MODE = 0o700;

function ownedByUs(stats: Stats): boolean {
  const uid = process.getuid?.();
  return uid === undefined || stats.uid === uid;
}

async function makePrivate(dir: string): Promise<void> {
  const stats = await lstat(dir);
  if (!stats.isDirectory() || stats.isSymbolicLink() || !ownedByUs(stats)) {
    throw new Error('The update cache is not a private directory');
  }
  await chmod(dir, PRIVATE_DIR_MODE);
}

async function sha512Of(file: string): Promise<string> {
  const before = await lstat(file);
  if (!before.isFile() || !ownedByUs(before)) {
    throw new Error('The downloaded update is not a regular file');
  }
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = await handle.stat();
    if (opened.ino !== before.ino || opened.dev !== before.dev) {
      throw new Error('The downloaded update changed while it was verified');
    }
    const hash = createHash('sha512');
    for await (const chunk of handle.createReadStream({ autoClose: false })) {
      hash.update(chunk as Buffer);
    }
    return hash.digest('base64');
  } finally {
    await handle.close();
  }
}

export async function verifyDownload(file: string, expectedSha512: string): Promise<void> {
  const pending = dirname(file);
  await makePrivate(dirname(pending));
  await makePrivate(pending);
  if ((await sha512Of(file)) !== expectedSha512) {
    throw new Error('The downloaded update does not match its sha512');
  }
}
