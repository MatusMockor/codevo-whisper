import { afterEach, describe, expect, it } from 'vitest';
import { LlmError, serverProvider } from '../src/main/ai/llm-client';
import { polish } from '../src/main/ai/polish';
import { completion, json, startFakeLlmServer, type FakeLlmServer } from './fake-llm-server';
import { RecordingLogger } from './recording-logger';

const RAW = 'no takže ehm zajtra o desiatej nie o jedenástej mám poradu';
const SECRET_KEY = 'sk-never-logged';

let server: FakeLlmServer | null = null;

function logged(logger: RecordingLogger): string {
  return JSON.stringify([...logger.infos, ...logger.warns, ...logger.errors.map(({ message, error }) => ({ message, error: String(error) }))]);
}

afterEach(async () => {
  await server?.close();
  server = null;
});

async function polishWith(reply: (request: { body: string }) => string | null, timeoutMs = 2_000) {
  server = await startFakeLlmServer((request, response) => {
    const content = reply(request);
    if (content === null) return;
    json(response, 200, completion(content));
  });
  const logger = new RecordingLogger();
  const { text, failure } = await polish(RAW, { complete: serverProvider({ baseUrl: server.baseUrl, model: 'qwen2.5:1.5b', apiKey: SECRET_KEY }), signal: new AbortController().signal, logger, timeoutMs });
  return { text, failure, logger, requests: server.requests };
}

describe('polish', () => {
  it('sends the transcript as JSON in its own user message after the instructions and returns the edit', async () => {
    const { text, failure, requests } = await polishWith(() => 'Zajtra o jedenástej mám poradu.');
    expect(text).toBe('Zajtra o jedenástej mám poradu.');
    expect(failure).toBeNull();
    const { messages } = JSON.parse(requests[0]?.body ?? '') as { messages: Array<{ role: string; content: string }> };
    expect(messages.map((message) => message.role)).toEqual(['system', 'user']);
    expect(JSON.parse(messages[1]?.content ?? '')).toEqual({ transcript: RAW });
    expect(messages[0]?.content).not.toContain(RAW);
  });

  it.each([
    ['empty output', ''],
    ['an answer far shorter than the input', 'Áno.'],
    ['an answer far longer than the input', `Samozrejme, tu je plán porady: ${'bod programu, '.repeat(20)}`],
  ])('keeps the input on %s', async (_case, reply) => {
    const { text, logger } = await polishWith(() => reply);
    expect(text).toBe(RAW);
    expect(logged(logger)).not.toContain(RAW);
  });

  it('keeps the input when the server fails, without logging the transcript or the key', async () => {
    server = await startFakeLlmServer((_request, response) => json(response, 500, { error: 'boom' }));
    const logger = new RecordingLogger();
    const result = await polish(RAW, { complete: serverProvider({ baseUrl: server.baseUrl, model: 'm', apiKey: SECRET_KEY }), signal: new AbortController().signal, logger });
    expect(result).toEqual({ text: RAW, failure: 'http' });
    expect(logger.warns).toHaveLength(1);
    expect(logged(logger)).not.toContain(RAW);
    expect(logged(logger)).not.toContain(SECRET_KEY);
  });

  it('keeps the input when the server does not answer within the timeout', async () => {
    const started = Date.now();
    const { text, failure } = await polishWith(() => null, 200);
    expect(text).toBe(RAW);
    expect(failure).toBe('timeout');
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it('keeps the input when the dictation is cancelled', async () => {
    server = await startFakeLlmServer(() => undefined);
    const controller = new AbortController();
    const run = polish(RAW, { complete: serverProvider({ baseUrl: server.baseUrl, model: 'm', apiKey: null }), signal: controller.signal, logger: new RecordingLogger() });
    controller.abort();
    expect((await run).text).toBe(RAW);
  });

  it('keeps the input and reports why when Codex CLI cannot polish', async () => {
    const complete = () => Promise.reject(new LlmError('codex-logged-out', 'Codex CLI exited with 1'));
    expect(await polish(RAW, { complete, signal: new AbortController().signal, logger: new RecordingLogger() })).toEqual({ text: RAW, failure: 'codex-logged-out' });
  });
});
