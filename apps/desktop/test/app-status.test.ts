import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FakeInputHelper } from '../src/main/helper/fake-input-helper';
import { ModelManager } from '../src/main/models/model-manager';
import { AskedPermissionsStore } from '../src/main/permissions/asked-permissions-store';
import { MACOS_PERMISSION_LINKS } from '../src/main/permissions/macos-permission-links';
import { PermissionsService } from '../src/main/permissions/permissions-service';
import { PauseState } from '../src/main/session/pause-state';
import { SettingsStore } from '../src/main/settings/settings-store';
import { AppStatusService } from '../src/main/status/app-status-service';
import type { AppStatus } from '../src/shared/app-status';
import { testEntry } from './model-fixtures';
import { RecordingLogger } from './recording-logger';

const FN = { kind: 'modifiers', keycodes: [63], label: 'Fn / 🌐' } as const;
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
  const models = new ModelManager({ dir: modelsDir, catalog: [testEntry('tiny', MODEL_BODY), testEntry('other', 'OTHER')], settings, fetchImpl: () => Promise.reject(new Error('offline')), warmUp: () => Promise.resolve(), logger });
  const helper = new FakeInputHelper();
  let microphone = 'granted';
  let permissionReads = 0;
  const permissions = new PermissionsService({
    helper,
    microphone: {
      status: () => {
        permissionReads += 1;
        return microphone;
      },
      ask: () => Promise.resolve(true),
    },
    links: MACOS_PERMISSION_LINKS,
    openUrl: () => Promise.resolve(),
    asked: new AskedPermissionsStore(join(scratch, 'asked-permissions.json'), logger),
    logger,
  });
  const pause = new PauseState(logger);
  let paired = false;
  let repair = false;
  const pairingListeners = new Set<() => void>();
  const server = {
    isPaired: () => Promise.resolve(paired),
    needsRepair: () => repair,
    onChange: (listener: () => void) => {
      pairingListeners.add(listener);
      return () => pairingListeners.delete(listener);
    },
  };
  service = new AppStatusService({ settings, models, permissions, pause, server, logger });
  const changes: AppStatus[] = [];
  service.onChange((status) => changes.push(status));
  service.start();
  return {
    settings,
    models,
    permissionReads: () => permissionReads,
    helper,
    pause,
    service,
    changes,
    denyMicrophone: () => {
      microphone = 'denied';
    },
    setPaired: (value: boolean) => {
      paired = value;
      pairingListeners.forEach((listener) => listener());
    },
    setRepair: (value: boolean) => {
      repair = value;
      pairingListeners.forEach((listener) => listener());
    },
  };
}

describe('AppStatusService', () => {
  it('reports the hotkey, the active model, permissions and pause', async () => {
    const harness = await prepared();

    expect(await harness.service.status()).toEqual({ hotkeyLabel: null, mode: 'smart', modelReady: false, pairingNeeded: false, serverRepairNeeded: false, permissionsOk: true, paused: false });

    await harness.settings.update({ hotkey: FN, localModelId: 'tiny' });
    await expect.poll(() => harness.changes.at(-1)).toEqual({ hotkeyLabel: 'Fn / 🌐', mode: 'smart', modelReady: true, pairingNeeded: false, serverRepairNeeded: false, permissionsOk: true, paused: false });

    await harness.settings.update({ localModelId: 'other' });
    await expect.poll(() => harness.changes.at(-1)).toMatchObject({ modelReady: false });

    harness.pause.set(true);
    await expect.poll(() => harness.changes.at(-1)).toMatchObject({ paused: true });

    harness.denyMicrophone();
    harness.service.refresh();
    await expect.poll(() => harness.changes.at(-1)).toMatchObject({ permissionsOk: false });

    expect(await harness.service.status()).toEqual({ hotkeyLabel: 'Fn / 🌐', mode: 'smart', modelReady: false, pairingNeeded: false, serverRepairNeeded: false, permissionsOk: false, paused: true });
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

  it('reports the dictation mode so the banner can say press instead of hold', async () => {
    const harness = await prepared();

    await harness.settings.update({ mode: 'toggle' });

    await expect.poll(() => harness.changes.at(-1)).toMatchObject({ mode: 'toggle' });
  });

  it('refreshes on model changes only when the readiness of the active model changes', async () => {
    const harness = await prepared();
    await harness.settings.update({ localModelId: 'tiny' });
    await expect.poll(() => harness.changes.at(-1)).toMatchObject({ modelReady: true });
    const reads = harness.permissionReads();

    await harness.models.download('other').catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(harness.permissionReads()).toBe(reads);

    await harness.models.delete('tiny');
    await expect.poll(() => harness.changes.at(-1)).toMatchObject({ modelReady: false });
  });

  it('counts a paired server as a ready engine only when the order uses it', async () => {
    const harness = await prepared();
    await harness.settings.update({ engineOrder: ['server'] });
    await expect.poll(() => harness.changes.at(-1)).toMatchObject({ modelReady: false, pairingNeeded: true });

    harness.setPaired(true);
    await expect.poll(() => harness.changes.at(-1)).toMatchObject({ modelReady: true, pairingNeeded: false });

    await harness.settings.update({ engineOrder: ['local'] });
    await expect.poll(() => harness.changes.at(-1)).toMatchObject({ modelReady: false, pairingNeeded: false });

    await harness.settings.update({ engineOrder: ['local', 'server'] });
    await expect.poll(() => harness.changes.at(-1)).toMatchObject({ modelReady: true, pairingNeeded: false });
  });

  it('reports a server that needs re-pairing and does not count it as usable', async () => {
    const harness = await prepared();
    await harness.settings.update({ engineOrder: ['server', 'local'] });
    harness.setPaired(true);
    await expect.poll(() => harness.changes.at(-1)).toMatchObject({ modelReady: true, serverRepairNeeded: false });

    harness.setRepair(true);
    await expect.poll(() => harness.changes.at(-1)).toMatchObject({ modelReady: false, serverRepairNeeded: true });

    await harness.settings.update({ engineOrder: ['local'] });
    await expect.poll(() => harness.changes.at(-1)).toMatchObject({ serverRepairNeeded: false });
  });
});
