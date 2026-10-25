import { _electron as electron, type ElectronApplication } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const mainEntry = fileURLToPath(new URL('../out/main/index.js', import.meta.url));

function electronEnv(): Record<string, string> {
  const entries = Object.entries(process.env).filter(
    (entry): entry is [string, string] => entry[0] !== 'ELECTRON_RUN_AS_NODE' && entry[1] !== undefined,
  );
  return Object.fromEntries(entries);
}

export function launchApp(): Promise<ElectronApplication> {
  return electron.launch({ args: [mainEntry], env: electronEnv() });
}
