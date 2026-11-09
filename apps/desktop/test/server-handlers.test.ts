import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { serverHandlers } from '../src/main/ipc/server-handlers';
import { IpcValidationError } from '../src/main/ipc/validate';
import type { ServerService } from '../src/main/remote/server-service';
import { SettingsStore } from '../src/main/settings/settings-store';
import { RecordingLogger } from './recording-logger';
import { createServerService, tinyModels } from './support/server-service';

let dir: string;
let service: ServerService;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'cw-server-handlers-'));
  const logger = new RecordingLogger();
  const settings = new SettingsStore(join(dir, 'settings.json'), logger);
  await settings.load();
  const models = await tinyModels(dir, settings, logger, false);
  service = createServerService({ dir, settings, models, logger, timeoutMs: 500 }).service;
});

afterEach(async () => {
  service.dispose();
  await rm(dir, { recursive: true, force: true });
});

describe('serverHandlers', () => {
  it('answers calls without arguments', async () => {
    const handlers = serverHandlers({ server: service });

    expect(await handlers.getServer()).toEqual({ storage: 'available', server: null, pairing: { kind: 'idle' } });
    await handlers.checkServer();
    await handlers.cancelServerPairing();
    expect(await handlers.disconnectServer()).toEqual({ revokeCommand: null });
  });

  it('rejects arguments on the calls that take none', async () => {
    const handlers = serverHandlers({ server: service });

    await expect(handlers.getServer('x')).rejects.toThrow(IpcValidationError);
    await expect(handlers.cancelServerPairing(1)).rejects.toThrow(IpcValidationError);
    await expect(handlers.checkServer({ force: true })).rejects.toThrow(IpcValidationError);
    await expect(handlers.disconnectServer(undefined)).rejects.toThrow(IpcValidationError);
  });

  it('accepts exactly a pairing token for pairServer', async () => {
    const handlers = serverHandlers({ server: service });

    await expect(handlers.pairServer('')).rejects.toThrow(IpcValidationError);
    await expect(handlers.pairServer(42)).rejects.toThrow(IpcValidationError);
  });
});
