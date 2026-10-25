import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';
import { resolveHelperBinary } from '../src/main/helper/helper-binary';

const DESKTOP_DIR = fileURLToPath(new URL('..', import.meta.url));
const HELPER_DIR = join(DESKTOP_DIR, '..', '..', 'native', 'macos-helper');
const BUILD_SCRIPT = join(HELPER_DIR, 'build.sh');

function newestSourceMtime(): number {
  const sources = readdirSync(join(HELPER_DIR, 'Sources')).map((name) => join(HELPER_DIR, 'Sources', name));
  return Math.max(...[BUILD_SCRIPT, ...sources].map((file) => statSync(file).mtimeMs));
}

function isFresh(binary: string): boolean {
  return existsSync(binary) && statSync(binary).mtimeMs >= newestSourceMtime();
}

export function ensureBuiltHelper(): string {
  const binary = resolveHelperBinary({ isPackaged: false, resourcesPath: '', appPath: DESKTOP_DIR, arch: process.arch });
  if (isFresh(binary)) {
    return binary;
  }
  const build = spawnSync(BUILD_SCRIPT, [process.arch], { encoding: 'utf8', stdio: 'pipe' });
  expect(build.status, `${build.error?.message ?? ''}${build.stdout}${build.stderr}`).toBe(0);
  return binary;
}
