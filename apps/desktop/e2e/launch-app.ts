import { _electron as electron, type ElectronApplication } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const mainEntry = fileURLToPath(new URL('../out/main/index.js', import.meta.url));

function electronEnv(userDataDir: string): Record<string, string> {
  const entries = Object.entries(process.env).filter(
    (entry): entry is [string, string] => entry[0] !== 'ELECTRON_RUN_AS_NODE' && entry[1] !== undefined,
  );
  return { ...Object.fromEntries(entries), CW_USER_DATA_DIR: userDataDir };
}

export function createUserDataDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'cw-e2e-'));
}

export function removeUserDataDir(dir: string): Promise<void> {
  return rm(dir, { recursive: true, force: true });
}

export function launchApp(userDataDir: string): Promise<ElectronApplication> {
  return electron.launch({ args: [mainEntry], env: electronEnv(userDataDir) });
}
