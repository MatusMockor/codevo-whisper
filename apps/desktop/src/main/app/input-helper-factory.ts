import { app } from 'electron';
import { FakeInputHelper } from '../helper/fake-input-helper';
import { resolveHelperBinary } from '../helper/helper-binary';
import { HelperProcess } from '../helper/helper-process';
import { HelperProcessInputHelper } from '../helper/helper-process-input-helper';
import type { InputHelper } from '../helper/input-helper';
import type { Logger } from '../logging/logger';

export function createInputHelper(logger: Logger, fake: boolean): InputHelper {
  if (fake) {
    return new FakeInputHelper();
  }
  const file = resolveHelperBinary({
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    appPath: app.getAppPath(),
    arch: process.arch,
  });
  return new HelperProcessInputHelper(new HelperProcess({ file, args: [] }, { logger }), logger);
}
