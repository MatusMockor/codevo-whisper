import { _electron as electron, type ElectronApplication } from '@playwright/test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Settings } from '../src/shared/settings';

const mainEntry = fileURLToPath(new URL('../out/main/index.js', import.meta.url));

export type LaunchOptions = { fakeHelper?: boolean };

function electronEnv(userDataDir: string, options: LaunchOptions): Record<string, string> {
  const entries = Object.entries(process.env).filter(
    (entry): entry is [string, string] => entry[0] !== 'ELECTRON_RUN_AS_NODE' && entry[0] !== 'CW_E2E_FAKE_HELPER' && entry[1] !== undefined,
  );
  const fake: Record<string, string> = options.fakeHelper === true ? { CW_E2E_FAKE_HELPER: '1' } : {};
  return { ...Object.fromEntries(entries), CW_USER_DATA_DIR: userDataDir, CW_E2E_HOOKS: '1', ...fake };
}

export async function createUserDataDir(settings?: Partial<Settings>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'cw-e2e-'));
  if (settings !== undefined) {
    await writeFile(join(dir, 'settings.json'), JSON.stringify(settings));
  }
  return dir;
}

export const ONBOARDED: Partial<Settings> = Object.freeze({ onboardingDone: true });

export function removeUserDataDir(dir: string): Promise<void> {
  return rm(dir, { recursive: true, force: true });
}

export const FAKE_DEVICE_ARGS: readonly string[] = Object.freeze(['--use-fake-device-for-media-stream']);

export const FAKE_MEDIA_ARGS: readonly string[] = Object.freeze([...FAKE_DEVICE_ARGS, '--use-fake-ui-for-media-stream']);

export function launchApp(userDataDir: string, chromiumArgs: readonly string[] = FAKE_MEDIA_ARGS, options: LaunchOptions = {}): Promise<ElectronApplication> {
  return electron.launch({ args: [...chromiumArgs, mainEntry], env: electronEnv(userDataDir, options) });
}
