import { randomBytes } from 'node:crypto';
import { mkdir, open, readFile, rename, rm, stat } from 'node:fs/promises';

const PRIVATE_FILE_MODE = 0o600;
const PRIVATE_DIR_MODE = 0o700;
const GROUP_OR_OTHER = 0o077;

export async function ensurePrivateDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true, mode: PRIVATE_DIR_MODE });
}

export async function writePrivateFileAtomic(path: string, content: string): Promise<void> {
  const temp = `${path}.${randomBytes(6).toString('hex')}.tmp`;
  const handle = await open(temp, 'wx', PRIVATE_FILE_MODE);
  try {
    await handle.writeFile(content, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await rename(temp, path);
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

export async function readPrivateFile(path: string, options: { requirePrivateMode: boolean }): Promise<string | null> {
  try {
    const info = await stat(path);
    if (options.requirePrivateMode && (info.mode & GROUP_OR_OTHER) !== 0) {
      throw new Error(`${path} has group or other permissions; run chmod 600 on it`);
    }
    return await readFile(path, 'utf8');
  } catch (error) {
    if (isMissing(error)) {
      return null;
    }
    throw error;
  }
}
