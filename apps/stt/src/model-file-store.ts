import { rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { missingFiles } from './model-files';
import { syncDirectory } from './sync-directory';

export interface ModelFileStore {
  exists(target: string): Promise<boolean>;
  remove(target: string): Promise<void>;
}

export class LocalModelFileStore implements ModelFileStore {
  async exists(target: string): Promise<boolean> {
    return (await missingFiles([target])).length === 0;
  }

  async remove(target: string): Promise<void> {
    await rm(target, { force: true });
    await syncDirectory(dirname(target));
  }
}
