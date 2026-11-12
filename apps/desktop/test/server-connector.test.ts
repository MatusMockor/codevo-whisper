import { createServer, type Server, type Socket } from 'node:net';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { DICTATION_LANGUAGES, UNKNOWN_MODELS } from '@codevo-whisper/protocol';
import { ROUTING_MODELS, ROUTING_STT } from '../../server/test/support/fake-stt-server';
import type { ServerPairing } from '../src/main/remote/pairing-repository';
import type { RemoteFailureKind } from '../src/main/remote/remote-failure';
import { ServerConnector, type ConnectionObserver } from '../src/main/remote/server-connector';
import type { ConnectedServer } from '../src/shared/server';
import { freePort, startTestGateway, type TestGateway } from './support/gateway';

class RecordingObserver implements ConnectionObserver {
  readonly events: Array<{ connected: number } | { failed: RemoteFailureKind }> = [];
  readonly servers: ConnectedServer[] = [];

  connected(server: ConnectedServer): void {
    this.events.push({ connected: server.connectMs });
    this.servers.push(server);
  }

  failed(kind: RemoteFailureKind): void {
    this.events.push({ failed: kind });
  }
}

let gateway: TestGateway | undefined;
let silent: Server | undefined;
const sockets: Socket[] = [];

afterEach(async () => {
  await gateway?.close();
  gateway = undefined;
  sockets.splice(0).forEach((socket) => socket.destroy());
  await new Promise<void>((resolve) => {
    if (silent === undefined) {
      resolve();
      return;
    }
    silent.close(() => resolve());
  });
  silent = undefined;
});

function connector(pairing: ServerPairing | null, observer = new RecordingObserver(), timeoutMs = 2000): ServerConnector {
  return new ServerConnector({ pairings: { load: () => Promise.resolve(pairing) }, observer, clock: Date.now, timeoutMs });
}

describe('ServerConnector', () => {
  it('opens a session that the gateway answers with ready', async () => {
    gateway = await startTestGateway();
    const observer = new RecordingObserver();

    const ready = await connector(await gateway.addDevice(), observer).connect();

    expect(ready.serverVersion).toMatch(/\S/);
    expect(ready.connectMs).toBeGreaterThanOrEqual(0);
    expect(observer.events).toEqual([{ connected: ready.connectMs }]);
    expect(gateway.server.gateway.sessions.count()).toBe(1);
    ready.connection.close();
  });

  it('asks a current server which dictation languages it routes and reports them with its models', async () => {
    gateway = await startTestGateway({ stt: { capabilities: ROUTING_STT } });
    const observer = new RecordingObserver();

    const ready = await connector(await gateway.addDevice(), observer).connect();

    const languages = { kind: 'reported', languages: [...DICTATION_LANGUAGES], models: ROUTING_MODELS };
    expect(ready.languages).toEqual(languages);
    expect(observer.servers).toEqual([{ connectMs: ready.connectMs, serverVersion: ready.serverVersion, languages }]);
    ready.connection.close();
  });

  it('reports a current server without the language models as routing no language', async () => {
    gateway = await startTestGateway();

    const ready = await connector(await gateway.addDevice()).connect();

    expect(ready.languages).toEqual({ kind: 'reported', languages: [], models: UNKNOWN_MODELS });
    ready.connection.close();
  });

  it('never asks a server older than 0.3.0 and reports it as outdated', async () => {
    gateway = await startTestGateway({ stt: { capabilities: ROUTING_STT }, server: { serverVersion: '0.2.7' } });
    const observer = new RecordingObserver();

    const ready = await connector(await gateway.addDevice(), observer).connect();

    expect(ready.serverVersion).toBe('0.2.7');
    expect(ready.languages).toEqual({ kind: 'outdated', minVersion: '0.3.0' });
    expect(observer.servers.map((server) => server.languages)).toEqual([{ kind: 'outdated', minVersion: '0.3.0' }]);
    ready.connection.close();
  });

  it('asks again on a reconnect and reports what the server routes now', async () => {
    gateway = await startTestGateway({ stt: { capabilities: ROUTING_STT } });
    const observer = new RecordingObserver();
    const serverConnector = connector(await gateway.addDevice(), observer);
    const first = await serverConnector.connect();
    first.connection.close();
    gateway.stt.setCapabilities({ status: 200, body: { languages: [], models: { ...ROUTING_MODELS, conditioned: null, languageId: null } } });

    const again = await serverConnector.reconnect(first);

    expect(again.languages).toEqual({ kind: 'reported', languages: [], models: { transcription: ROUTING_MODELS.transcription, conditioned: null, languageId: null } });
    expect(observer.servers.map((server) => server.languages.kind)).toEqual(['reported', 'reported']);
    again.connection.close();
  });

  it('reports a revoked device as unknown', async () => {
    gateway = await startTestGateway();
    const pairing = await gateway.addDevice();
    await gateway.admin({ cmd: 'revoke', deviceId: pairing.deviceId });
    const observer = new RecordingObserver();

    await expect(connector(pairing, observer).connect()).rejects.toMatchObject({ kind: 'device-unknown' });
    expect(observer.events).toEqual([{ failed: 'device-unknown' }]);
  });

  it('reports a rotated server key as a changed key', async () => {
    gateway = await startTestGateway();
    const pairing = await gateway.addDevice();
    await gateway.admin({ cmd: 'rotate-key' });

    await expect(connector(pairing).connect()).rejects.toMatchObject({ kind: 'server-key-changed' });
  });

  it('reports offline when the gateway is down', async () => {
    gateway = await startTestGateway();
    const pairing = await gateway.addDevice();
    await gateway.stop();

    await expect(connector(pairing).connect()).rejects.toMatchObject({ kind: 'offline' });
  });

  it('times out on an endpoint that accepts TCP but never answers', async () => {
    silent = createServer((socket) => sockets.push(socket));
    const port = await freePort();
    await new Promise<void>((resolve) => silent?.listen(port, '127.0.0.1', resolve));
    gateway = await startTestGateway();
    const pairing = { ...(await gateway.addDevice()), endpoint: `ws://127.0.0.1:${(silent.address() as AddressInfo).port}` };
    const startedAt = Date.now();

    await expect(connector(pairing, new RecordingObserver(), 200).connect()).rejects.toMatchObject({ kind: 'timeout' });
    expect(Date.now() - startedAt).toBeLessThan(1500);
  });

  it('refuses without a pairing', async () => {
    const observer = new RecordingObserver();

    await expect(connector(null, observer).connect()).rejects.toMatchObject({ kind: 'not-paired' });
    expect(observer.events).toEqual([{ failed: 'not-paired' }]);
  });
});
