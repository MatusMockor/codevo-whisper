import { describe, expect, it } from 'vitest';
import { FakeInputHelper } from '../src/main/helper/fake-input-helper';
import type { Permissions } from '../src/main/helper/input-helper';
import { PermissionsService } from '../src/main/permissions/permissions-service';
import { RecordingLogger } from './recording-logger';

class UnavailableHelper extends FakeInputHelper {
  override permissions(): Promise<Permissions> {
    return Promise.reject(new Error('helper is not running'));
  }
}

describe('PermissionsService', () => {
  it('reports microphone, input monitoring and accessibility', async () => {
    const helper = new FakeInputHelper({ permissions: { listen: true, post: false, accessibility: false } });
    let microphone = 'granted';
    const service = new PermissionsService(helper, () => microphone, new RecordingLogger());

    expect(await service.status()).toEqual({ microphone: true, listen: true, accessibility: false });

    microphone = 'not-determined';
    helper.permissionState = { listen: true, post: true, accessibility: true };
    expect(await service.status()).toEqual({ microphone: false, listen: true, accessibility: true });
  });

  it('waits until the input helper has started before reading permissions', async () => {
    const started = Promise.withResolvers<void>();
    const service = new PermissionsService(new UnavailableHelper(), () => 'granted', new RecordingLogger(), started.promise);
    let settled = false;

    const status = service.status().finally(() => {
      settled = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(settled).toBe(false);

    started.resolve();
    await expect(status).resolves.toEqual({ microphone: true, listen: false, accessibility: false });
  });

  it('treats an unavailable helper as missing permissions and logs it', async () => {
    const logger = new RecordingLogger();
    const service = new PermissionsService(new UnavailableHelper(), () => 'granted', logger);

    expect(await service.status()).toEqual({ microphone: true, listen: false, accessibility: false });
    expect(logger.errors).toHaveLength(1);
  });
});
