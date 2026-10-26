import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server, type Socket } from 'node:net';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EngineSelector } from '../src/main/engines/engine-selector';
import type { Preparation, TranscriptionEngine } from '../src/main/engines/transcription-engine';
import type { ServerPairing } from '../src/main/remote/pairing-repository';
import { RemoteEngine } from '../src/main/remote/remote-engine';
import { ServerConnector } from '../src/main/remote/server-connector';
import { LocalEngine } from '../src/main/engines/local-engine';
import { ModelManager } from '../src/main/models/model-manager';
import { SettingsStore } from '../src/main/settings/settings-store';
import { FAKE_CLI } from '../../../packages/stt-runner/test/support/fake-cli';
import { stampedPcm } from './in-process-capture';
import { testEntry } from './model-fixtures';
import { startTestGateway, type TestGateway } from './support/gateway';

const MODEL_BODY = 'GGUF';

let scratch: string;
let settings: SettingsStore;
let gateway: TestGateway | null = null;

beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), 'cw-selector-'));
  vi.stubEnv('FAKE_CLI_ARGS_FILE', join(scratch, 'args.txt'));
  vi.stubEnv('FAKE_CLI_MODE', 'echo-chunk');
  settings = new SettingsStore(join(scratch, 'settings.json'));
  await settings.load();
});

afterEach(async () => {
  await gateway?.close();
  gateway = null;
  vi.unstubAllEnvs();
  await rm(scratch, { recursive: true, force: true });
});

async function localEngine(withModel: boolean): Promise<LocalEngine> {
  const modelsDir = join(scratch, 'models');
  await mkdir(modelsDir, { recursive: true });
  if (withModel) {
    await writeFile(join(modelsDir, 'tiny.gguf'), MODEL_BODY);
    await settings.update({ localModelId: 'tiny' });
  }
  const models = new ModelManager({ dir: modelsDir, catalog: [testEntry('tiny', MODEL_BODY)], settings, warmUp: () => Promise.resolve() });
  return new LocalEngine({ binary: FAKE_CLI, models, settings, arch: 'arm64' });
}

describe('EngineSelector', () => {
  it('starts the first ready engine and streams the pushed audio into it', async () => {
    const selector = new EngineSelector([await localEngine(true)]);

    const preparation = await selector.prepare(['local']);

    expect(preparation.ready).toBe(true);
    const engine = preparation.ready ? preparation.engine : null;
    expect(engine?.id).toBe('local');
    const dictation = engine?.start({ language: 'sk', signal: new AbortController().signal });
    dictation?.push(stampedPcm(3, 1));
    dictation?.push(stampedPcm(3, 1));
    expect(await dictation?.finish()).toBe('3:64000');
  });

  it('skips an order entry without a registered engine', async () => {
    const selector = new EngineSelector([await localEngine(true)]);

    const preparation = await selector.prepare(['server', 'local']);

    expect(preparation.ready && preparation.engine.id).toBe('local');
  });

  it('reports the reason of the first engine in the order when none is ready', async () => {
    const selector = new EngineSelector([await localEngine(false)]);

    expect(await selector.prepare(['local'])).toEqual({ ready: false, reason: 'no-model' });
  });

  it('is not ready without any engine for the order', async () => {
    const selector = new EngineSelector([await localEngine(true)]);

    expect(await selector.prepare(['server'])).toEqual({ ready: false });
  });

  describe('with a server that needs re-pairing', () => {
    async function remoteEngine(breakPairing: (server: TestGateway, pairing: ServerPairing) => Promise<unknown>): Promise<RemoteEngine> {
      gateway = await startTestGateway();
      const pairing = await gateway.addDevice();
      await breakPairing(gateway, pairing);
      const observer = { connected: () => undefined, failed: () => undefined };
      const connector = new ServerConnector({ pairings: { load: () => Promise.resolve(pairing) }, observer, clock: Date.now, timeoutMs: 2000 });
      return new RemoteEngine({ connector, observer });
    }

    const revoke = (server: TestGateway, pairing: ServerPairing) => server.admin({ cmd: 'revoke', deviceId: pairing.deviceId });
    const rotate = (server: TestGateway) => server.admin({ cmd: 'rotate-key' });

    it('never falls back to local after a revoke with Server, potom lokálne', async () => {
      const selector = new EngineSelector([await localEngine(true), await remoteEngine(revoke)]);

      expect(await selector.prepare(['server', 'local'])).toEqual({ ready: false, reason: 'server-repair-needed' });
    });

    it('never falls back to local after the server key changed', async () => {
      const selector = new EngineSelector([await localEngine(true), await remoteEngine(rotate)]);

      expect(await selector.prepare(['server', 'local'])).toEqual({ ready: false, reason: 'server-repair-needed' });
      expect(await selector.prepare(['server'])).toEqual({ ready: false, reason: 'server-repair-needed' });
    });

    it('reports the re-pair reason instead of the missing model with Lokálne, potom server', async () => {
      const selector = new EngineSelector([await localEngine(false), await remoteEngine(revoke)]);

      expect(await selector.prepare(['local', 'server'])).toEqual({ ready: false, reason: 'server-repair-needed' });
    });

    it('still falls back to local when the server is merely offline', async () => {
      const remote = await remoteEngine(async (server) => server.stop());
      const selector = new EngineSelector([await localEngine(true), remote]);

      const preparation = await selector.prepare(['server', 'local']);

      expect(preparation.ready && preparation.engine.id).toBe('local');
    });
  });

  describe('Server, potom lokálne with an unreachable server', () => {
    let silent: Server | null = null;
    const sockets: Socket[] = [];

    afterEach(async () => {
      sockets.splice(0).forEach((socket) => socket.destroy());
      await new Promise<void>((resolve) => (silent === null ? resolve() : silent.close(() => resolve())));
      silent = null;
    });

    function timed(engine: TranscriptionEngine, events: string[]): TranscriptionEngine {
      return {
        id: engine.id,
        prepare: async (): Promise<Preparation> => {
          events.push(`${engine.id}:start`);
          const preparation = await engine.prepare();
          events.push(`${engine.id}:end`);
          return preparation;
        },
      };
    }

    it('prepares the local engine while it waits for the server', async () => {
      silent = createServer((socket) => sockets.push(socket));
      await new Promise<void>((resolve) => silent?.listen(0, '127.0.0.1', resolve));
      gateway = await startTestGateway();
      const pairing = { ...(await gateway.addDevice()), endpoint: `ws://127.0.0.1:${(silent.address() as AddressInfo).port}` };
      const observer = { connected: () => undefined, failed: () => undefined };
      const connector = new ServerConnector({ pairings: { load: () => Promise.resolve(pairing) }, observer, clock: Date.now, timeoutMs: 300 });
      const events: string[] = [];
      const selector = new EngineSelector([timed(await localEngine(true), events), timed(new RemoteEngine({ connector, observer }), events)]);

      const preparation = await selector.prepare(['server', 'local']);

      expect(preparation.ready && preparation.engine.id).toBe('local');
      expect(events.indexOf('local:start')).toBeLessThan(events.indexOf('server:end'));
    });
  });
});
