import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { HistoryStore } from '../src/main/history/history-store';

let dir: string;
let file: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'cw-history-'));
  file = join(dir, 'history.json');
});
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

it('starts OFF and never retains completed text or creates a file without consent', async () => {
  const store = new HistoryStore(file);
  await store.record('súkromný prepis');
  expect(await store.view()).toEqual({ kind: 'ready', policy: { enabled: false, limit: 100 }, entries: [], writeError: false });
  expect(await readdir(dir)).toEqual([]);
  expect(await new HistoryStore(file).view()).toEqual(await store.view());
});

it('persists consent and exact successful text with only the text history schema', async () => {
  const store = new HistoryStore(file);
  await store.configure({ enabled: true, limit: 100 });
  await store.record('Presný prepis. ');
  const view = await store.view();
  expect(view).toMatchObject({ kind: 'ready', policy: { enabled: true, limit: 100 }, entries: [{ text: 'Presný prepis. ' }], writeError: false });
  if (view.kind !== 'ready') throw new Error('History unavailable');
  expect(view.entries[0]?.id).toMatch(/^[0-9a-f-]{36}$/);
  expect(view.entries[0]?.completedAt).toBeGreaterThan(0);
  expect(await new HistoryStore(file).view()).toEqual(view);
  expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({ version: 1, policy: { enabled: true, limit: 100 }, entries: view.entries });
  expect((await stat(file)).mode & 0o777).toBe(0o600);
  expect(await readdir(dir)).toEqual(['history.json']);
});

it('evicts by completion order at ten and immediately prunes when the limit is lowered', async () => {
  const store = new HistoryStore(file);
  await store.configure({ enabled: true, limit: 10 });
  for (let i = 1; i <= 11; i++) await store.record(`prepis ${i}`);
  let view = await store.view();
  if (view.kind !== 'ready') throw new Error('History unavailable');
  expect(view.entries.map((entry) => entry.text)).toEqual(['prepis 11', 'prepis 10', 'prepis 9', 'prepis 8', 'prepis 7', 'prepis 6', 'prepis 5', 'prepis 4', 'prepis 3', 'prepis 2']);
  await store.configure({ enabled: true, limit: 50 });
  await store.record('prepis 12');
  await store.configure({ enabled: true, limit: 10 });
  view = await new HistoryStore(file).view();
  expect(view).toMatchObject({ policy: { enabled: true, limit: 10 } });
  if (view.kind !== 'ready') throw new Error('History unavailable');
  expect(view.entries).toHaveLength(10);
  expect(view.entries.at(-1)?.text).toBe('prepis 3');
});

it('serializes consent, deletion, clear and disable without backfill or resurrection', async () => {
  const store = new HistoryStore(file);
  const beforeConsent = store.record('never backfill');
  const enable = store.configure({ enabled: true, limit: 10 });
  const record = store.record('first');
  await Promise.all([beforeConsent, enable, record]);
  let view = await store.view();
  if (view.kind !== 'ready') throw new Error('History unavailable');
  const id = view.entries[0]?.id;
  if (!id) throw new Error('Missing completed entry');
  expect(view.entries.map((entry) => entry.text)).toEqual(['first']);
  await store.deleteEntry(id);
  await store.deleteEntry(id);
  expect(await new HistoryStore(file).view()).toMatchObject({ entries: [] });
  await store.record('second');
  await store.clear();
  expect(await store.view()).toMatchObject({ policy: { enabled: true, limit: 10 }, entries: [] });
  const pending = [store.record('third'), store.configure({ enabled: false, limit: 10 }), store.record('fourth')];
  await Promise.all(pending);
  view = await new HistoryStore(file).view();
  expect(view).toMatchObject({ policy: { enabled: false, limit: 10 }, entries: [] });
  await store.configure({ enabled: true, limit: 10 });
  await store.record('   ');
  expect(await store.view()).toMatchObject({ entries: [] });
});

it('keeps committed entries visible and removes temporary text when persistence fails', async () => {
  const store = new HistoryStore(file);
  await store.configure({ enabled: true, limit: 10 });
  await store.record('committed');
  await rm(file);
  await mkdir(file);
  await expect(store.record('must not remain in tmp')).rejects.toThrow('History could not be saved');
  expect(await store.view()).toMatchObject({ entries: [{ text: 'committed' }], writeError: true });
  expect(await readdir(dir)).toEqual(['history.json']);
  await expect(store.clear()).rejects.toThrow('History could not be saved');
  expect(await store.view()).toMatchObject({ entries: [{ text: 'committed' }], writeError: true });
});

it('fails closed for malformed files and removes only the stale history temporary file on startup', async () => {
  await writeFile(file, '{broken sensitive text');
  await writeFile(`${file}.tmp`, 'interrupted sensitive text');
  await writeFile(join(dir, 'stats.json.tmp'), 'unrelated');
  const store = new HistoryStore(file);
  expect(await store.view()).toEqual({ kind: 'unavailable' });
  await expect(store.configure({ enabled: true, limit: 10 })).rejects.toThrow('History is unavailable');
  expect(await readFile(file, 'utf8')).toBe('{broken sensitive text');
  expect((await readdir(dir)).sort()).toEqual(['history.json', 'stats.json.tmp']);
});

it('drains queued completions before quit and publishes only committed text', async () => {
  const store = new HistoryStore(file);
  const published: Promise<unknown>[] = [];
  store.onChange((view) => {
    if (view.kind === 'ready' && !view.writeError) published.push(readFile(file, 'utf8').then((text) => {
      expect(JSON.parse(text)).toMatchObject({ policy: view.policy, entries: view.entries });
    }));
  });
  const enabled = store.configure({ enabled: true, limit: 10 });
  expect(store.isBusy()).toBe(true);
  await enabled;
  await Promise.all(published);
  const records = [store.record('one'), store.record('two')];
  await store.settled();
  expect(store.isBusy()).toBe(false);
  expect(await new HistoryStore(file).view()).toMatchObject({ entries: [{ text: 'two' }, { text: 'one' }] });
  await Promise.all(records);
  await Promise.all(published);
});

it('shows unavailable rather than a ready empty history when temporary cleanup fails', async () => {
  await mkdir(`${file}.tmp`);
  await writeFile(join(`${file}.tmp`, 'retained'), 'stale text');
  expect(await new HistoryStore(file).view()).toEqual({ kind: 'unavailable' });
});

it.each([
  { version: 2, policy: { enabled: true, limit: 10 }, entries: [] },
  { version: 1, policy: { enabled: false, limit: 7 }, entries: [] },
  { version: 1, policy: { enabled: false, limit: 10 }, entries: [{ id: '00000000-0000-4000-8000-000000000000', completedAt: 1, text: 'unexpected' }] },
  { version: 1, policy: { enabled: true, limit: 10 }, entries: Array.from({ length: 11 }, (_, i) => ({ id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`, completedAt: i, text: 'too many' })) },
])('fails closed on an inconsistent stored history %#', async (envelope) => {
  await writeFile(file, JSON.stringify(envelope));
  expect(await new HistoryStore(file).view()).toEqual({ kind: 'unavailable' });
});
