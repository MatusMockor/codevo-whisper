import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { HelperProcess } from '../src/main/helper/helper-process';
import { HelperProcessInputHelper } from '../src/main/helper/helper-process-input-helper';
import { ensureBuiltHelper } from './built-helper';
import { RecordingLogger } from './recording-logger';

let channel: HelperProcess;
let helper: HelperProcessInputHelper;

describe.runIf(process.platform === 'darwin')('macOS input helper', () => {
  beforeAll(async () => {
    channel = new HelperProcess({ file: ensureBuiltHelper(), args: [] }, { logger: new RecordingLogger() });
    helper = new HelperProcessInputHelper(channel);
    await helper.start();
  }, 180_000);

  afterAll(async () => {
    await helper?.stop();
  });

  it('ping answers', async () => {
    const pong = await channel.request('ping');

    expect(pong.pong).toBe(true);
    expect(typeof pong.pid).toBe('number');
  });

  it('permissions returns three booleans', async () => {
    const permissions = await helper.permissions();

    expect(Object.keys(permissions).sort()).toEqual(['accessibility', 'listen', 'post']);
    Object.values(permissions).forEach((granted) => expect(typeof granted).toBe('boolean'));
  });

  it('frontmost returns a bundle id', async () => {
    const target = await helper.frontmost();

    expect(target?.bundleId).toMatch(/\S/);
    expect(target?.pid).toBeGreaterThan(0);
  });

  it('secure-input returns a boolean', async () => {
    expect(typeof (await helper.secureInput())).toBe('boolean');
  });
});
