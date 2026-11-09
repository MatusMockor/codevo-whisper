import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EngineRouting } from '../src/main/engines/engine-routing';
import { engineHandlers } from '../src/main/ipc/engine-handlers';
import { ActiveModelReadiness } from '../src/main/models/local-model-readiness';
import type { ServerService } from '../src/main/remote/server-service';
import { SettingsStore } from '../src/main/settings/settings-store';
import { SWITCH_FAILED_MESSAGE, SWITCH_REFUSED_MESSAGES, switchEngine, switchFailure, type EngineSwitchApi } from '../src/renderer/settings/prefer-engine';
import { RecordingLogger } from './recording-logger';
import { createServerService, tinyModels } from './support/server-service';

let dir: string;
let settings: SettingsStore;
let server: ServerService;
let bridge: EngineSwitchApi;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'cw-prefer-engine-'));
  const logger = new RecordingLogger();
  settings = new SettingsStore(join(dir, 'settings.json'), logger);
  await settings.load();
  await settings.update({ localModelId: 'tiny', engineOrder: ['local'] });
  const models = await tinyModels(dir, settings, logger, true);
  const harness = createServerService({ dir, settings, models, logger });
  server = harness.service;
  const handlers = engineHandlers({ routing: new EngineRouting({ order: harness.order, local: new ActiveModelReadiness(models, settings), server }) });
  bridge = { preferEngine: (engine) => handlers.preferEngine(engine) };
});

afterEach(async () => {
  vi.restoreAllMocks();
  server.dispose();
  await rm(dir, { recursive: true, force: true });
});

describe('switchEngine', () => {
  it('shows nothing after a switch the main process applied', async () => {
    await settings.update({ engineOrder: ['server'] });

    await expect(switchEngine('local', bridge)).resolves.toBeNull();

    expect(settings.get().engineOrder).toEqual(['local']);
  });

  it('tells the user why the main process refused the switch and keeps the order', async () => {
    await expect(switchEngine('server', bridge)).resolves.toBe(SWITCH_REFUSED_MESSAGES['server-not-paired']);

    expect(settings.get().engineOrder).toEqual(['local']);
  });

  it('asks the user to retry when the switch request itself fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const closed: EngineSwitchApi = { preferEngine: () => Promise.reject(new Error('The IPC channel closed')) };

    await expect(switchEngine('server', closed)).resolves.toBe(SWITCH_FAILED_MESSAGE);

    expect(settings.get().engineOrder).toEqual(['local']);
  });

  it('treats a malformed switch outcome as a failed switch', () => {
    expect(switchFailure(undefined)).toBe(SWITCH_FAILED_MESSAGE);
    expect(switchFailure({ kind: 'refused', reason: 'cloud' })).toBe(SWITCH_FAILED_MESSAGE);
  });

  it('keeps every failure message in Slovak without long dashes', () => {
    for (const message of [SWITCH_FAILED_MESSAGE, ...Object.values(SWITCH_REFUSED_MESSAGES)]) {
      expect(message).toMatch(/nepodarilo prepnúť/);
      expect(message).not.toMatch(/[–—]/);
    }
  });
});
