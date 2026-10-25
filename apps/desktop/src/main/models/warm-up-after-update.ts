import type { ActiveModel } from '../engines/active-model';
import { writeFileAtomic } from '../fs/atomic-write';
import { readOptionalFile } from '../fs/read-optional-file';
import type { Logger } from '../logging/logger';
import { isPlainRecord } from '../settings/settings-fields';
import type { WarmUp } from './warm-up';

export type WarmUpAfterUpdateDeps = {
  file: string;
  appVersion: string;
  models: ActiveModel;
  warmUp: WarmUp;
  logger: Logger;
};

async function warmedVersion(file: string): Promise<string | null> {
  try {
    const parsed: unknown = JSON.parse((await readOptionalFile(file)) ?? 'null');
    return isPlainRecord(parsed) && typeof parsed['appVersion'] === 'string' ? parsed['appVersion'] : null;
  } catch {
    return null;
  }
}

async function warmActiveModel(deps: WarmUpAfterUpdateDeps): Promise<boolean> {
  const path = await deps.models.activeModelPath();
  if (path === null || (await deps.models.verifyActive()) !== 'ok') {
    return true;
  }
  try {
    await deps.warmUp(path);
    return true;
  } catch (error) {
    deps.logger.error('Warm-up after an app update failed', error);
    return false;
  }
}

export async function warmUpAfterUpdate(deps: WarmUpAfterUpdateDeps): Promise<void> {
  if ((await warmedVersion(deps.file)) === deps.appVersion) {
    return;
  }
  if (!(await warmActiveModel(deps))) {
    return;
  }
  await writeFileAtomic(deps.file, `${JSON.stringify({ appVersion: deps.appVersion })}\n`);
}
