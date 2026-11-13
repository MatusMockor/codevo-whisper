import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { LlmError, serverProvider } from '../src/main/ai/llm-client';
import { polish, type PolishRequest } from '../src/main/ai/polish';
import { completion, json, startFakeLlmServer, type FakeLlmServer } from './fake-llm-server';
import { RecordingLogger } from './recording-logger';

const RAW = 'no takže ehm zajtra o desiatej nie o jedenástej mám poradu';
const SECRET_KEY = 'sk-never-logged';
const TRUNK_BODY = readFileSync(new URL('./fixtures/polish-request-trunk.json', import.meta.url), 'utf8');
const BARE: PolishRequest = { text: RAW, words: [], context: null };
const BEFORE = 'Ahoj Peter, posielam Vám zápis z porady s klientom Kumiba. ';
const AFTER = ' S pozdravom, Martin z oddelenia vývoja aplikácií';
const INSTRUCTIONS = 'Píš vykanie s veľkým V.';

type Sent = { model: string; messages: Array<{ role: string; content: string }> };

function sent(requests: Array<{ body: string }>): Sent {
  return JSON.parse(requests[0]?.body ?? '') as Sent;
}

function userJson(message: { content: string } | undefined): Record<string, unknown> {
  return JSON.parse(message?.content ?? '') as Record<string, unknown>;
}

function trunkSystem(): string {
  return (JSON.parse(TRUNK_BODY) as Sent).messages[0]?.content ?? '';
}

let server: FakeLlmServer | null = null;

function logged(logger: RecordingLogger): string {
  return JSON.stringify([...logger.infos, ...logger.warns, ...logger.errors.map(({ message, error }) => ({ message, error: String(error) }))]);
}

afterEach(async () => {
  await server?.close();
  server = null;
});

async function polishWith(reply: (request: { body: string }) => string | null, timeoutMs = 2_000, request: PolishRequest = BARE, instructions = '') {
  server = await startFakeLlmServer((request, response) => {
    const content = reply(request);
    if (content === null) return;
    json(response, 200, completion(content));
  });
  const logger = new RecordingLogger();
  const { text, failure } = await polish(request, { complete: serverProvider({ baseUrl: server.baseUrl, model: 'qwen2.5:1.5b', apiKey: SECRET_KEY }), signal: new AbortController().signal, logger, timeoutMs, instructions });
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
    const result = await polish(BARE, { complete: serverProvider({ baseUrl: server.baseUrl, model: 'm', apiKey: SECRET_KEY }), signal: new AbortController().signal, logger });
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
    const run = polish(BARE, { complete: serverProvider({ baseUrl: server.baseUrl, model: 'm', apiKey: null }), signal: controller.signal, logger: new RecordingLogger() });
    controller.abort();
    expect((await run).text).toBe(RAW);
  });

  it('keeps the input and reports why when Codex CLI cannot polish', async () => {
    const complete = () => Promise.reject(new LlmError('codex-logged-out', 'Codex CLI exited with 1'));
    expect(await polish(BARE, { complete, signal: new AbortController().signal, logger: new RecordingLogger() })).toEqual({ text: RAW, failure: 'codex-logged-out' });
  });

  it.each([
    ['no instructions', ''],
    ['blank instructions', '  \n '],
  ])('sends exactly the trunk request with no words, no context and %s', async (_case, instructions) => {
    server = await startFakeLlmServer((_request, response) => json(response, 200, completion('Zajtra o jedenástej mám poradu.')));
    await polish(BARE, { complete: serverProvider({ baseUrl: server.baseUrl, model: 'qwen2.5:1.5b', apiKey: null }), signal: new AbortController().signal, logger: new RecordingLogger(), instructions });
    expect(server.requests[0]?.body).toBe(TRUNK_BODY);
  });

  it('asks for the custom words as preferred spellings', async () => {
    const { requests } = await polishWith(() => 'Zajtra o jedenástej mám poradu s Kumibou.', 2_000, { text: `${RAW} s kumíbou`, words: ['Kumiba', 'Codevo'], context: null });
    const [system, user] = sent(requests).messages;
    expect(Object.keys(userJson(user))).toEqual(['transcript', 'preferredSpellings']);
    expect(userJson(user)).toEqual({ transcript: `${RAW} s kumíbou`, preferredSpellings: ['Kumiba', 'Codevo'] });
    expect(system?.content.startsWith(trunkSystem())).toBe(true);
    expect(system?.content).toContain('"preferredSpellings"');
  });

  it('appends the custom instructions after the built-in prompt without logging them', async () => {
    const { text, logger, requests } = await polishWith(() => 'Áno.', 2_000, BARE, `  ${INSTRUCTIONS}\n`);
    const [system, user] = sent(requests).messages;
    expect(system?.content.startsWith(`${trunkSystem()}\n\n`)).toBe(true);
    expect(system?.content.endsWith(`\n${INSTRUCTIONS}`)).toBe(true);
    expect(userJson(user)).toEqual({ transcript: RAW });
    expect(text).toBe(RAW);
    expect(logged(logger)).not.toContain(INSTRUCTIONS);
  });

  it('sends the text around the cursor as context only, with the instructions last', async () => {
    const { text, requests } = await polishWith(() => 'Zajtra o jedenástej mám poradu.', 2_000, { text: RAW, words: ['Kumiba'], context: { before: BEFORE, after: AFTER } }, INSTRUCTIONS);
    const [system, user] = sent(requests).messages;
    expect(Object.keys(userJson(user))).toEqual(['transcript', 'preferredSpellings', 'context']);
    expect(userJson(user)['context']).toEqual({ before: BEFORE, after: AFTER });
    expect(system?.content).toContain('"context"');
    expect(system?.content.indexOf('"preferredSpellings"')).toBeLessThan(system?.content.indexOf('"context"') ?? -1);
    expect(system?.content.endsWith(INSTRUCTIONS)).toBe(true);
    expect(system?.content).not.toContain(BEFORE.trim());
    expect(text).toBe('Zajtra o jedenástej mám poradu.');
  });

  it.each([
    ['before', `${BEFORE.trim()} Zajtra o jedenástej mám poradu.`],
    ['after', `Zajtra o jedenástej mám poradu.   S pozdravom,\nMartin z oddelenia vývoja`],
  ])('keeps the raw transcript when the answer copies the text %s the cursor, without logging it', async (_side, reply) => {
    const { text, failure, logger } = await polishWith(() => reply, 2_000, { text: RAW, words: [], context: { before: BEFORE, after: AFTER } }, INSTRUCTIONS);
    expect(text).toBe(RAW);
    expect(failure).toBeNull();
    expect(logger.warns).toHaveLength(1);
    expect(logged(logger)).not.toContain('Kumiba');
    expect(logged(logger)).not.toContain('pozdravom');
    expect(logged(logger)).not.toContain(RAW);
    expect(logged(logger)).not.toContain(INSTRUCTIONS);
  });

  it('keeps the raw transcript when context was sent and the answer is not an edit of it', async () => {
    const { text, failure, logger } = await polishWith(() => 'HACKED', 2_000, { text: 'ahoj svet', words: [], context: { before: BEFORE, after: AFTER } });
    expect(text).toBe('ahoj svet');
    expect(failure).toBeNull();
    expect(logger.warns).toHaveLength(1);
  });

  it('accepts the same unrelated answer when no context was sent, as on trunk', async () => {
    const { text } = await polishWith(() => 'HACKED', 2_000, { text: 'ahoj svet', words: [], context: null });
    expect(text).toBe('HACKED');
  });

  it('accepts a capitalization and punctuation correction of a sentence that is also in the context', async () => {
    const dictated = 'ďakujem za pomoc pri riešení tohto problému';
    const edited = 'Ďakujem za pomoc pri riešení tohto problému.';
    const { text } = await polishWith(() => edited, 2_000, { text: dictated, words: [], context: { before: edited, after: '' } });
    expect(text).toBe(edited);
  });

  it('accepts preferred spellings the transcript misheard when context was sent', async () => {
    const { text } = await polishWith(() => 'Pošli to do Kumiby.', 2_000, { text: 'pošli to do kumíby', words: ['Kumiba'], context: { before: BEFORE, after: AFTER } });
    expect(text).toBe('Pošli to do Kumiby.');
  });

  it('accepts an answer that repeats text around the cursor when the speaker dictated it', async () => {
    const dictated = 'ehm s pozdravom martin z oddelenia vývoja';
    const { text } = await polishWith(() => 's pozdravom martin z oddelenia vývoja.', 2_000, { text: dictated, words: [], context: { before: BEFORE, after: ' s   pozdravom martin\nz oddelenia vývoja aplikácií' } });
    expect(text).toBe('s pozdravom martin z oddelenia vývoja.');
  });
});
