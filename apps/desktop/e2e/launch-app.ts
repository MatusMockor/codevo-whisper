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
  return { ...Object.fromEntries(entries), CW_USER_DATA_DIR: userDataDir, CW_E2E_HOOKS: '1' };
}

export function createUserDataDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'cw-e2e-'));
}

export function removeUserDataDir(dir: string): Promise<void> {
  return rm(dir, { recursive: true, force: true });
}

export const FAKE_DEVICE_ARGS: readonly string[] = Object.freeze(['--use-fake-device-for-media-stream']);

export const FAKE_MEDIA_ARGS: readonly string[] = Object.freeze([...FAKE_DEVICE_ARGS, '--use-fake-ui-for-media-stream']);

export function launchApp(userDataDir: string, chromiumArgs: readonly string[] = []): Promise<ElectronApplication> {
  return electron.launch({ args: [...chromiumArgs, mainEntry], env: electronEnv(userDataDir) });
}
