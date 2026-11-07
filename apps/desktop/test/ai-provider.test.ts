import { mkdir, mkdtemp, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { polish } from '../src/main/ai/polish';
import { chooseProvider, type ProviderSettings } from '../src/main/ai/provider';
import { MeetingNotes } from '../src/main/meetings/meeting-notes';
import { MeetingStore } from '../src/main/meetings/meeting-store';
import { completion, json, startFakeLlmServer, type FakeLlmServer } from './fake-llm-server';
import { RecordingLogger } from './recording-logger';

const FAKE_CODEX = fileURLToPath(new URL('./support/fake-codex.sh', import.meta.url));
const RAW = 'ehm zajtra o desiatej nie o jedenástej mám poradu';

let dir: string;
let codexEnv: NodeJS.ProcessEnv;
let server: FakeLlmServer;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'cw-provider-'));
  await mkdir(join(dir, 'bin'));
  await symlink(FAKE_CODEX, join(dir, 'bin', 'codex'));
  codexEnv = { PATH: `${join(dir, 'bin')}:${process.env['PATH'] ?? ''}`, HOME: dir, FAKE_CODEX_DIR: dir, FAKE_CODEX_ANSWER: 'Zajtra o jedenástej mám poradu, píše Codex.' };
  server = await startFakeLlmServer((_request, response) => json(response, 200, completion('Zajtra o jedenástej mám poradu, píše server.')));
});

afterEach(async () => {
  await server.close();
  await rm(dir, { recursive: true, force: true });
});

function settings(overrides: Partial<ProviderSettings>): ProviderSettings {
  return { aiProvider: 'server', aiBaseUrl: server.baseUrl, aiModel: 'qwen2.5:7b', codexModel: 'gpt-6-luna', codexEffort: 'low', ...overrides };
}

function choose(overrides: Partial<ProviderSettings>) {
  return chooseProvider(settings(overrides), () => Promise.resolve(null), codexEnv);
}

async function polished(overrides: Partial<ProviderSettings>): Promise<string> {
  const complete = await choose(overrides);
  if (complete === null) throw new Error('no provider');
  return polish(RAW, { complete, signal: new AbortController().signal, logger: new RecordingLogger() });
}

it('polishes through the configured server by default and never starts Codex', async () => {
  expect(await polished({})).toBe('Zajtra o jedenástej mám poradu, píše server.');
  expect(server.requests).toHaveLength(1);
  await expect(readFile(join(dir, 'args'), 'utf8')).rejects.toThrow();
});

it('polishes through Codex with the chosen model and effort once the user picks it, sending nothing to the server', async () => {
  expect(await polished({ aiProvider: 'codex', aiBaseUrl: null, aiModel: '', codexModel: 'gpt-6-sol', codexEffort: 'medium' })).toBe('Zajtra o jedenástej mám poradu, píše Codex.');
  expect(server.requests).toEqual([]);
  const args = (await readFile(join(dir, 'args'), 'utf8')).split('\n');
  expect(args).toEqual(expect.arrayContaining(['gpt-6-sol', 'model_reasoning_effort=medium']));
  expect(await readFile(join(dir, 'stdin'), 'utf8')).toContain(JSON.stringify({ transcript: RAW }));
});

it('applies the length guard to a Codex answer too', async () => {
  codexEnv['FAKE_CODEX_ANSWER'] = 'Áno.';
  expect(await polished({ aiProvider: 'codex' })).toBe(RAW);
});

it('has no provider while the server has no address or model', async () => {
  expect(await choose({ aiBaseUrl: null })).toBeNull();
  expect(await choose({ aiModel: '' })).toBeNull();
});

it('writes meeting notes through Codex', async () => {
  codexEnv['FAKE_CODEX_ANSWER'] = '## Zhrnutie\n\nDohodli sa na piatku.';
  const store = new MeetingStore(join(dir, 'meetings'), new RecordingLogger());
  await store.load();
  const { id } = await store.create({ startedAt: Date.now(), systemAudio: 'recording', systemAudioNote: null });
  await store.finishTranscript(id, [{ speaker: 'Ja', t0Ms: 0, t1Ms: 2_000, text: 'Piatok nám vyhovuje.' }]);

  await new MeetingNotes({ store, provider: () => choose({ aiProvider: 'codex' }), logger: new RecordingLogger() }).generate(id);

  await expect(store.meeting(id)).resolves.toMatchObject({ notes: '## Zhrnutie\n\nDohodli sa na piatku.', notesError: null });
  expect(await readFile(join(dir, 'stdin'), 'utf8')).toContain('[00:00] Ja: Piatok nám vyhovuje.');
  expect(server.requests).toEqual([]);
});
