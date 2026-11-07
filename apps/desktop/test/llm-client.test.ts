import { afterEach, describe, expect, it } from 'vitest';
import { chat, listModels, LlmError, type LlmEndpoint } from '../src/main/ai/llm-client';
import { completion, json, startFakeLlmServer, type FakeLlmServer } from './fake-llm-server';

let server: FakeLlmServer | null = null;

afterEach(async () => {
  await server?.close();
  server = null;
});

function endpoint(fake: FakeLlmServer, overrides: Partial<LlmEndpoint> = {}): LlmEndpoint {
  return { baseUrl: fake.baseUrl, model: 'qwen2.5:1.5b', apiKey: null, ...overrides };
}

const MESSAGES = [{ role: 'user', content: 'ahoj' }] as const;

async function failure(run: Promise<unknown>): Promise<LlmError> {
  const error: unknown = await run.then(() => null, (caught: unknown) => caught);
  expect(error).toBeInstanceOf(LlmError);
  return error as LlmError;
}

describe('chat', () => {
  it('posts a non-streaming completion to the normalized base URL and returns the content', async () => {
    server = await startFakeLlmServer((_request, response) => json(response, 200, completion('Ahoj.')));
    const text = await chat({ endpoint: endpoint(server, { baseUrl: `${server.baseUrl}/` }), messages: MESSAGES, timeoutMs: 2_000 });
    expect(text).toBe('Ahoj.');
    const [request] = server.requests;
    expect(request).toMatchObject({ method: 'POST', url: '/v1/chat/completions' });
    expect(request?.headers['content-type']).toBe('application/json');
    expect(request?.headers.authorization).toBeUndefined();
    expect(JSON.parse(request?.body ?? '')).toEqual({ model: 'qwen2.5:1.5b', messages: MESSAGES, temperature: 0.2, stream: false });
  });

  it('sends the API key as a bearer token only when one is stored', async () => {
    server = await startFakeLlmServer((_request, response) => json(response, 200, completion('ok')));
    await chat({ endpoint: endpoint(server, { apiKey: 'sk-local' }), messages: MESSAGES, timeoutMs: 2_000 });
    expect(server.requests[0]?.headers.authorization).toBe('Bearer sk-local');
  });

  it('strips reasoning blocks, including one the model never closed', async () => {
    const replies = ['<think>plan\nsteps</think>\n\nHotový text.', 'Pred <think>a</think>po<think>b</think>.', '<think>still thinking'];
    server = await startFakeLlmServer((_request, response) => json(response, 200, completion(replies.shift() ?? '')));
    const run = () => chat({ endpoint: endpoint(server!), messages: MESSAGES, timeoutMs: 2_000 });
    expect(await run()).toBe('Hotový text.');
    expect(await run()).toBe('Pred po.');
    expect(await run()).toBe('');
  });

  it('reports a non-200 answer, and a rejected key separately', async () => {
    const statuses = [500, 401];
    server = await startFakeLlmServer((_request, response) => json(response, statuses.shift() ?? 500, { error: 'nope' }));
    expect((await failure(chat({ endpoint: endpoint(server), messages: MESSAGES, timeoutMs: 2_000 }))).reason).toBe('http');
    expect((await failure(chat({ endpoint: endpoint(server), messages: MESSAGES, timeoutMs: 2_000 }))).reason).toBe('unauthorized');
  });

  it('rejects a body that is not JSON or not a chat completion', async () => {
    const bodies = ['<html>proxy</html>', JSON.stringify({ choices: [] }), JSON.stringify({ choices: [{ message: { content: 7 } }] })];
    server = await startFakeLlmServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(bodies.shift());
    });
    for (let index = 0; index < 3; index++) {
      expect((await failure(chat({ endpoint: endpoint(server), messages: MESSAGES, timeoutMs: 2_000 }))).reason).toBe('bad-response');
    }
  });

  it('rejects a completion the server cut off at its token limit', async () => {
    server = await startFakeLlmServer((_request, response) => json(response, 200, { choices: [{ message: { content: 'Polovica' }, finish_reason: 'length' }] }));
    expect((await failure(chat({ endpoint: endpoint(server), messages: MESSAGES, timeoutMs: 2_000 }))).reason).toBe('bad-response');
  });

  it('stops reading a response larger than 1 MB', async () => {
    server = await startFakeLlmServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify(completion('x'.repeat(1024 * 1024))));
    });
    expect((await failure(chat({ endpoint: endpoint(server), messages: MESSAGES, timeoutMs: 2_000 }))).reason).toBe('too-large');
  });

  it('times out a server that never answers', async () => {
    server = await startFakeLlmServer(() => undefined);
    const started = Date.now();
    expect((await failure(chat({ endpoint: endpoint(server), messages: MESSAGES, timeoutMs: 200 }))).reason).toBe('timeout');
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it('times out a server that stalls in the middle of the body', async () => {
    server = await startFakeLlmServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.write('{"choices":');
    });
    expect((await failure(chat({ endpoint: endpoint(server), messages: MESSAGES, timeoutMs: 200 }))).reason).toBe('timeout');
  });

  it('reports the caller cancelling separately from a timeout', async () => {
    server = await startFakeLlmServer(() => undefined);
    const controller = new AbortController();
    const run = chat({ endpoint: endpoint(server), messages: MESSAGES, timeoutMs: 5_000, signal: controller.signal });
    setTimeout(() => controller.abort(), 50);
    expect((await failure(run)).reason).toBe('aborted');
  });

  it('reports a closed port as unreachable', async () => {
    server = await startFakeLlmServer(() => undefined);
    const closed = endpoint(server);
    await server.close();
    server = null;
    expect((await failure(chat({ endpoint: closed, messages: MESSAGES, timeoutMs: 2_000 }))).reason).toBe('unreachable');
  });
});

describe('listModels', () => {
  it('lists the model ids the server offers and skips malformed entries', async () => {
    server = await startFakeLlmServer((_request, response) => json(response, 200, { object: 'list', data: [{ id: 'qwen2.5:1.5b' }, { id: 7 }, 'junk', { id: 'llama3.2:3b' }] }));
    expect(await listModels({ baseUrl: server.baseUrl, apiKey: 'sk-local' })).toEqual(['qwen2.5:1.5b', 'llama3.2:3b']);
    expect(server.requests[0]).toMatchObject({ method: 'GET', url: '/v1/models' });
    expect(server.requests[0]?.headers.authorization).toBe('Bearer sk-local');
  });

  it('rejects a models answer without a data list', async () => {
    server = await startFakeLlmServer((_request, response) => json(response, 200, { models: [] }));
    expect((await failure(listModels({ baseUrl: server.baseUrl, apiKey: null }))).reason).toBe('bad-response');
  });
});
