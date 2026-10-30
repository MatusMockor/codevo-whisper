import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { startInput } from '../src/main/app/start-input';
import { HelperProcess } from '../src/main/helper/helper-process';
import { HelperProcessInputHelper } from '../src/main/helper/helper-process-input-helper';
import { FakeInputHelper } from '../src/main/helper/fake-input-helper';
import { RecordingLogger } from './recording-logger';

describe('startInput', () => {
  it('starts the helper before the hotkey service', async () => {
    const helper = new FakeInputHelper();
    const order: string[] = [];
    const hotkeys = {
      start: () => {
        order.push(helper.running ? 'hotkeys-after-helper' : 'hotkeys-before-helper');
        return Promise.resolve();
      },
    };

    await startInput(helper, hotkeys, new RecordingLogger());

    expect(order).toEqual(['hotkeys-after-helper']);
  });

  it('logs and resolves when the helper binary is missing', async () => {
    const logger = new RecordingLogger();
    const missing = join(tmpdir(), 'cw-missing-helper', 'codevo-input-helper');
    const helper = new HelperProcessInputHelper(new HelperProcess({ kind: 'direct', file: missing, args: [] }, { logger }), logger);
    let hotkeysStarted = false;
    const hotkeys = {
      start: () => {
        hotkeysStarted = true;
        return Promise.resolve();
      },
    };

    await expect(startInput(helper, hotkeys, logger)).resolves.toBeUndefined();

    expect(hotkeysStarted).toBe(false);
    expect(logger.errors.map((entry) => entry.message)).toContain('The hotkey is unavailable');
  });
});
