import { join } from 'node:path';

export const APP_NAME = 'Codevo Whisper';

export type UserDataDirInput = { isPackaged: boolean; appDataDir: string; override: string | undefined };

export function resolveUserDataDir({ isPackaged, appDataDir, override }: UserDataDirInput): string {
  if (isPackaged) {
    return join(appDataDir, APP_NAME);
  }
  if (override !== undefined && override !== '') {
    return override;
  }
  return join(appDataDir, `${APP_NAME} Dev`);
}
