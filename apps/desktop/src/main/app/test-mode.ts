import { app } from 'electron';

export function isE2eMode(): boolean {
  return !app.isPackaged && process.env['CW_E2E_HOOKS'] === '1';
}
