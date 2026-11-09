import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { writeSettings } from '../src/main/ipc/core-handlers';
import { validateSettingsPatch } from '../src/main/ipc/validate';
import { SettingsStore } from '../src/main/settings/settings-store';
import { RecordingLogger } from './recording-logger';
import { startTestGateway, type TestGateway } from './support/gateway';
import { createServerService, tinyModels, type ServerServiceHarness } from './support/server-service';

let dir: string;
let gateway: TestGateway;
let settings: SettingsStore;
let harness: ServerServiceHarness;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'cw-core-handlers-'));
  gateway = await startTestGateway();
  const logger = new RecordingLogger();
  settings = new SettingsStore(join(dir, 'settings.json'), logger);
  await settings.load();
  const models = await tinyModels(dir, settings, logger, false);
  harness = createServerService({ dir, settings, models, logger });
  await harness.pairings.save(await gateway.addDevice());
});

afterEach(async () => {
  harness.service.dispose();
  await gateway.close();
  await rm(dir, { recursive: true, force: true });
});

function write(patch: unknown): ReturnType<typeof writeSettings> {
  return writeSettings({ settings, order: harness.order }, validateSettingsPatch(patch));
}

describe('writeSettings', () => {
  it('a disconnect never leaves the server as the only engine while the renderer saves an order with it', async () => {
    const saving = write({ engineOrder: ['server'] });
    await harness.service.disconnect();
    await saving;

    expect(settings.get().engineOrder).toEqual(['local']);
  });

  it('saves the engine order and the other settings of one patch', async () => {
    const saved = await write({ engineOrder: ['server', 'local'], language: 'en' });

    expect(saved).toMatchObject({ engineOrder: ['server', 'local'], language: 'en' });
    expect(settings.get()).toMatchObject({ engineOrder: ['server', 'local'], language: 'en' });
    expect(await write({ engineOrder: ['local'] })).toMatchObject({ engineOrder: ['local'], language: 'en' });
  });
});
