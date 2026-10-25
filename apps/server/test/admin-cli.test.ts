import { PassThrough } from 'node:stream';
import { fingerprint, generateKeyPair, parsePairingToken } from '@codevo-whisper/protocol';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runCli } from '../src/cli/commands';
import { startFakeSttServer, type FakeSttServer } from './support/fake-stt-server';
import { startHarness, type Harness } from './support/server-harness';
import { createTempDir } from './support/temp-dir';
import { connectSession, pairDevice } from './support/test-client';
import { waitUntil } from './support/wait-until';

let dir: Awaited<ReturnType<typeof createTempDir>>;
let fake: FakeSttServer;
let harness: Harness;

type Terminal = { input: PassThrough; output: PassThrough; text(): string };

function terminal(): Terminal {
  const input = new PassThrough();
  const output = new PassThrough();
  let written = '';
  output.on('data', (chunk: Buffer) => {
    written += chunk.toString('utf8');
  });
  return { input, output, text: () => written };
}

function cli(args: string[], term: Terminal): Promise<number> {
  return runCli(args, { input: term.input, output: term.output, socketPath: harness.config.adminSocket });
}

function tokenFrom(text: string): string {
  const match = /cw1:\S+/.exec(text);
  expect(match).not.toBeNull();
  return match?.[0] ?? '';
}

beforeEach(async () => {
  dir = await createTempDir();
  fake = await startFakeSttServer();
  harness = await startHarness(dir.path, fake.url);
});

afterEach(async () => {
  await harness.close();
  await fake.close();
  await dir.remove();
});

describe('codevo-whisper CLI', () => {
  it('pair prints the token and a QR code, shows both fingerprints and pairs on y', async () => {
    const term = terminal();
    const exit = cli(['pair'], term);
    await waitUntil(() => term.text().includes('cw1:'));
    const token = parsePairingToken(tokenFrom(term.text()));
    expect(term.text()).toContain('▄');
    const device = generateKeyPair();
    const pairing = pairDevice(harness.url, token, device, 'MacBook dev');
    await waitUntil(() => term.text().includes('Spárovať toto zariadenie? [y/N]'));
    term.input.write('y\n');
    const outcome = await pairing;

    expect(await exit).toBe(0);
    expect(outcome.status).toBe('approved');
    expect(term.text()).toContain('MacBook dev');
    expect(term.text()).toContain(fingerprint(device.publicKey));
    expect(term.text()).toContain(outcome.handshakeFingerprint);
    expect(term.text()).toContain(outcome.deviceId ?? 'missing');
  });

  it('pair rejects on anything but y', async () => {
    const term = terminal();
    const exit = cli(['pair'], term);
    await waitUntil(() => term.text().includes('cw1:'));
    const pairing = pairDevice(harness.url, parsePairingToken(tokenFrom(term.text())), generateKeyPair(), 'Cudzí');
    await waitUntil(() => term.text().includes('[y/N]'));
    term.input.write('\n');

    expect((await pairing).status).toBe('rejected');
    expect(await exit).toBe(1);
  });

  it('devices lists paired devices with fingerprints', async () => {
    const device = await harness.addDevice('Pracovný Mac');
    const term = terminal();

    expect(await cli(['devices'], term)).toBe(0);
    expect(term.text()).toContain('Pracovný Mac');
    expect(term.text()).toContain(fingerprint(device.publicKey));
  });

  it('revoke removes a device', async () => {
    const device = await harness.addDevice();
    const [registered] = await harness.devices.list();
    const term = terminal();

    expect(await cli(['revoke', registered?.id ?? ''], term)).toBe(0);
    await expect(connectSession(harness.url, device, harness.serverKey.publicKey)).rejects.toMatchObject({ code: 'unknown_device' });
    expect(await cli(['revoke', 'deadbeef'], terminal())).toBe(1);
  });

  it('rotate-key asks for confirmation', async () => {
    await harness.addDevice();
    const declined = terminal();
    const declinedExit = cli(['rotate-key'], declined);
    await waitUntil(() => declined.text().includes('Všetky zariadenia sa budú musieť znova spárovať. Pokračovať? [y/N]'));
    declined.input.write('n\n');
    expect(await declinedExit).toBe(1);
    expect(await harness.devices.list()).toHaveLength(1);

    const confirmed = terminal();
    const confirmedExit = cli(['rotate-key'], confirmed);
    await waitUntil(() => confirmed.text().includes('[y/N]'));
    confirmed.input.write('y\n');
    expect(await confirmedExit).toBe(0);
    expect(await harness.devices.list()).toHaveLength(0);
  });

  it('status reports devices, sessions and STT state', async () => {
    const device = await harness.addDevice();
    const session = await connectSession(harness.url, device, harness.serverKey.publicKey);
    expect(await session.next()).toMatchObject({ type: 'ready' });
    const up = terminal();

    expect(await cli(['status'], up)).toBe(0);
    expect(up.text()).toMatch(/Zariadenia: 1/);
    expect(up.text()).toMatch(/Aktívne relácie: 1/);
    expect(up.text()).toMatch(/Fronta: 0/);
    expect(up.text()).toMatch(/STT: UP/);

    await fake.close();
    const down = terminal();
    expect(await cli(['status'], down)).toBe(0);
    expect(down.text()).toMatch(/STT: DOWN/);
    fake = await startFakeSttServer();
  });

  it('reports a lost admin connection with a non-zero exit', async () => {
    const term = terminal();
    const exit = cli(['rotate-key'], term);
    await waitUntil(() => term.text().includes('[y/N]'));
    await harness.close();
    harness = await startHarness(dir.path, fake.url);
    term.input.write('y\n');

    expect(await exit).toBe(1);
    expect(term.text()).toContain('Spojenie so serverom sa prerušilo.');
  });

  it('prints usage for unknown commands', async () => {
    const term = terminal();

    expect(await cli(['explode'], term)).toBe(2);
    expect(term.text()).toContain('codevo-whisper <pair|devices|revoke <id>|rotate-key|status>');
  });
});
