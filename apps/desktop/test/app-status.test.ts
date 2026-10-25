import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FakeInputHelper } from '../src/main/helper/fake-input-helper';
import { ModelManager } from '../src/main/models/model-manager';
import { PermissionsService } from '../src/main/permissions/permissions-service';
import { PauseState } from '../src/main/session/pause-state';
import { SettingsStore } from '../src/main/settings/settings-store';
import { AppStatusService } from '../src/main/status/app-status-service';
import type { AppStatus } from '../src/shared/app-status';
import { testEntry } from './model-fixtures';
import { RecordingLogger } from './recording-logger';

const FN = { keycode: 63, label: 'Fn / 🌐' } as const;
const MODEL_BODY = 'GGUF';

let scratch: string;
let service: AppStatusService | null = null;

beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), 'cw-status-'));
});

afterEach(async () => {
  service?.dispose();
  service = null;
  await rm(scratch, { recursive: true, force: true });
});

async function prepared() {
  const logger = new RecordingLogger();
  const settings = new SettingsStore(join(scratch, 'settings.json'), logger);
  await settings.load();
  const modelsDir = join(scratch, 'models');
  await mkdir(modelsDir, { recursive: true });
  await writeFile(join(modelsDir, 'tiny.gguf'), MODEL_BODY);
  const models = new ModelManager({ dir: modelsDir, catalog: [testEntry('tiny', MODEL_BODY), testEntry('other', 'OTHER')], settings, warmUp: () => Promise.resolve(), logger });
  const helper = new FakeInputHelper();
  let microphone = 'granted';
  const permissions = new PermissionsService(helper, () => microphone, logger);
  const pause = new PauseState(logger);
  service = new AppStatusService({ settings, models, permissions, pause, logger });
  const changes: AppStatus[] = [];
  service.onChange((status) => changes.push(status));
  service.start();
  return {
    settings,
    helper,
    pause,
    service,
    changes,
    denyMicrophone: () => {
      microphone = 'denied';
    },
  };
}

describe('AppStatusService', () => {
  it('reports the hotkey, the active model, permissions and pause', async () => {
    const harness = await prepared();

    expect(await harness.service.status()).toEqual({ hotkeyLabel: null, modelReady: false, permissionsOk: true, paused: false });

    await harness.settings.update({ hotkey: FN, localModelId: 'tiny' });
    await expect.poll(() => harness.changes.at(-1)).toEqual({ hotkeyLabel: 'Fn / 🌐', modelReady: true, permissionsOk: true, paused: false });

    await harness.settings.update({ localModelId: 'other' });
    await expect.poll(() => harness.changes.at(-1)).toMatchObject({ modelReady: false });

    harness.pause.set(true);
    await expect.poll(() => harness.changes.at(-1)).toMatchObject({ paused: true });

    harness.denyMicrophone();
    harness.service.refresh();
    await expect.poll(() => harness.changes.at(-1)).toMatchObject({ permissionsOk: false });

    expect(await harness.service.status()).toEqual({ hotkeyLabel: 'Fn / 🌐', modelReady: false, permissionsOk: false, paused: true });
  });

  it('requires input monitoring and accessibility and emits only real changes', async () => {
    const harness = await prepared();

    harness.service.refresh();
    harness.service.refresh();
    await expect.poll(() => harness.changes).toHaveLength(1);

    harness.helper.permissionState = { listen: false, post: true, accessibility: true };
    harness.service.refresh();
    await expect.poll(() => harness.changes).toHaveLength(2);
    expect(harness.changes.at(-1)).toMatchObject({ permissionsOk: false });

    harness.helper.permissionState = { listen: true, post: true, accessibility: false };
    harness.service.refresh();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(harness.changes).toHaveLength(2);
  });
});
