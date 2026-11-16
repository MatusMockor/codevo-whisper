import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { HttpSttModelManagement } from '../src/stt/http-stt-model-management';
import { NO_MODEL_CATALOG } from '../src/stt/stt-model-management';
import { FAKE_CATALOG_MODELS } from './support/fake-model-catalog';

type Answer = { status: number; body: unknown };

let server: Server | undefined;
let requests: string[];

async function sttAnswering(answer: (method: string, path: string) => Answer): Promise<HttpSttModelManagement> {
  requests = [];
  server = createServer((request, response) => {
    requests.push(`${request.method ?? ''} ${request.url ?? ''}`);
    const { status, body } = answer(request.method ?? '', request.url ?? '');
    response.writeHead(status, { 'content-type': 'application/json' });
    response.end(typeof body === 'string' ? body : JSON.stringify(body));
  });
  await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve));
  return new HttpSttModelManagement(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
}

afterEach(async () => {
  await new Promise<void>((resolve) => (server === undefined ? resolve() : server.close(() => resolve())));
  server = undefined;
});

describe('HttpSttModelManagement', () => {
  it('reads the catalog of the stt', async () => {
    const stt = await sttAnswering(() => ({ status: 200, body: { downloadsEnabled: true, models: FAKE_CATALOG_MODELS } }));

    expect(await stt.catalog()).toEqual({ downloadsEnabled: true, models: FAKE_CATALOG_MODELS });
    expect(requests).toEqual(['GET /catalog']);
  });

  it('falls back to an empty catalog for an old, failing or malformed stt', async () => {
    const answers: Answer[] = [
      { status: 404, body: { error: 'not found' } },
      { status: 500, body: {} },
      { status: 200, body: 'not json' },
      { status: 200, body: { downloadsEnabled: true, models: [{ ...FAKE_CATALOG_MODELS[0], family: 'canary' }] } },
      { status: 200, body: { downloadsEnabled: 'yes', models: 'all' } },
    ];
    for (const answer of answers) {
      const stt = await sttAnswering(() => answer);
      const catalog = await stt.catalog();
      await new Promise<void>((resolve) => server?.close(() => resolve()));
      server = undefined;

      expect(catalog, JSON.stringify(answer)).toEqual(NO_MODEL_CATALOG);
    }
    expect(await new HttpSttModelManagement('http://127.0.0.1:9').catalog()).toEqual(NO_MODEL_CATALOG);
  });

  it('maps every stt answer to an operation outcome', async () => {
    const cases: Array<[Parameters<HttpSttModelManagement['run']>[0], Answer, string]> = [
      ['download', { status: 202, body: { status: 'started' } }, 'started'],
      ['download', { status: 200, body: { status: 'installed' } }, 'installed'],
      ['download', { status: 400, body: { error: 'unknown model' } }, 'unknown_model'],
      ['download', { status: 403, body: { error: 'downloads disabled' } }, 'downloads_disabled'],
      ['download', { status: 409, body: { error: 'download busy' } }, 'download_busy'],
      ['download', { status: 507, body: { error: 'insufficient space' } }, 'insufficient_space'],
      ['download', { status: 200, body: { status: 'removed' } }, 'stt_unavailable'],
      ['remove', { status: 200, body: { status: 'removed' } }, 'removed'],
      ['remove', { status: 200, body: { status: 'missing' } }, 'missing'],
      ['remove', { status: 409, body: { error: 'model in use' } }, 'model_in_use'],
      ['remove', { status: 409, body: { error: 'model not removable' } }, 'model_not_removable'],
      ['remove', { status: 500, body: { error: 'internal error' } }, 'stt_unavailable'],
      ['cancel', { status: 200, body: { status: 'cancelled' } }, 'cancelled'],
      ['cancel', { status: 200, body: { status: 'idle' } }, 'idle'],
      ['cancel', { status: 404, body: { error: 'not found' } }, 'stt_unavailable'],
    ];
    for (const [operation, answer, outcome] of cases) {
      const stt = await sttAnswering(() => answer);
      expect(await stt.run(operation, 'whisper-large-v3-turbo'), `${operation} ${JSON.stringify(answer)}`).toBe(outcome);
      await new Promise<void>((resolve) => server?.close(() => resolve()));
      server = undefined;
    }
  });

  it('sends each operation to its own endpoint', async () => {
    const stt = await sttAnswering(() => ({ status: 200, body: { status: 'idle' } }));

    await stt.run('download', 'whisper-large-v3-turbo');
    await stt.run('remove', 'whisper-large-v3-turbo');
    await stt.run('cancel', 'whisper-large-v3-turbo');

    expect(requests).toEqual(['POST /models/whisper-large-v3-turbo/download', 'DELETE /models/whisper-large-v3-turbo', 'POST /models/whisper-large-v3-turbo/cancel']);
  });

  it('answers stt_unavailable when the stt is unreachable', async () => {
    expect(await new HttpSttModelManagement('http://127.0.0.1:9').run('download', 'whisper-large-v3-turbo')).toBe('stt_unavailable');
  });
});
