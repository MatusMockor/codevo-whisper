import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EngineRouting } from '../src/main/engines/engine-routing';
import { engineHandlers } from '../src/main/ipc/engine-handlers';
import { IpcValidationError } from '../src/main/ipc/validate';
import { ActiveModelReadiness } from '../src/main/models/local-model-readiness';
import type { ServerService } from '../src/main/remote/server-service';
import { SettingsStore } from '../src/main/settings/settings-store';
import { RecordingLogger } from './recording-logger';
import { createServerService, tinyModels } from './support/server-service';

let dir: string;
let settings: SettingsStore;
let server: ServerService;
let handlers: ReturnType<typeof engineHandlers>;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'cw-engine-handlers-'));
  const logger = new RecordingLogger();
  settings = new SettingsStore(join(dir, 'settings.json'), logger);
  await settings.load();
  await settings.update({ localModelId: 'tiny', engineOrder: ['local'] });
  const models = await tinyModels(dir, settings, logger, true);
  const harness = createServerService({ dir, settings, models, logger });
  server = harness.service;
  handlers = engineHandlers({ routing: new EngineRouting({ order: harness.order, local: new ActiveModelReadiness(models, settings), server }) });
});

afterEach(async () => {
  server.dispose();
  await rm(dir, { recursive: true, force: true });
});

describe('engineHandlers', () => {
  it('never routes dictation to a server that is not paired', async () => {
    await handlers.preferEngine('server');

    expect(settings.get().engineOrder).toEqual(['local']);
  });

  it('puts a ready local engine first without a server fallback when none is paired', async () => {
    await settings.update({ engineOrder: ['server'] });

    await handlers.preferEngine('local');

    expect(settings.get().engineOrder).toEqual(['local']);
  });

  it('rejects unknown engines and extra arguments', async () => {
    await expect(handlers.preferEngine('cloud')).rejects.toThrow(IpcValidationError);
    await expect(handlers.preferEngine(['server'])).rejects.toThrow(IpcValidationError);
    await expect(handlers.preferEngine('local', 'server')).rejects.toThrow(IpcValidationError);
    await expect(handlers.preferEngine()).rejects.toThrow(IpcValidationError);
  });
});
