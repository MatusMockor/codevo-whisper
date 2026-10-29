import { app } from 'electron';
import { resolveHelperBinary } from '../helper/helper-binary';
import { HelperProcess } from '../helper/helper-process';
import { HelperProcessInputHelper } from '../helper/helper-process-input-helper';
import type { InputHelper } from '../helper/input-helper';
import type { Logger } from '../logging/logger';
import { desktopAppRoot } from './app-root';

async function fakeInputHelper(): Promise<InputHelper> {
  const { FakeInputHelper } = await import('../helper/fake-input-helper');
  return new FakeInputHelper();
}

export function createInputHelper(logger: Logger, fake: boolean): Promise<InputHelper> {
  if (fake) {
    return fakeInputHelper();
  }
  const file = resolveHelperBinary({
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    appPath: process.platform === 'linux' ? desktopAppRoot() : app.getAppPath(),
    arch: process.arch,
  });
  return Promise.resolve(new HelperProcessInputHelper(new HelperProcess({ file, args: [] }, { logger }), logger));
}
