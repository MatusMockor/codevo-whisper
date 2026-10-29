import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { HistoryStore } from '../src/main/history/history-store';
import { historyHandlers } from '../src/main/ipc/history-handlers';
import { IpcValidationError } from '../src/main/ipc/validate';

let dir: string;
let history: HistoryStore;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'cw-history-ipc-'));
  history = new HistoryStore(join(dir, 'history.json'));
});
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

it('configures and deletes through the user API while admitting no renderer text', async () => {
  const api = historyHandlers({ history });
  await api.configureHistory({ enabled: true, limit: 10 });
  await history.record('main-only completion');
  const view = await api.getHistory();
  expect(view).toMatchObject({ policy: { enabled: true, limit: 10 }, entries: [{ text: 'main-only completion' }] });
  if (view.kind !== 'ready' || !view.entries[0]) throw new Error('Missing entry');
  await api.deleteHistoryEntry(view.entries[0].id);
  expect(await api.getHistory()).toMatchObject({ entries: [] });
  await history.record('another');
  await api.clearHistory();
  expect(await api.getHistory()).toMatchObject({ policy: { enabled: true, limit: 10 }, entries: [] });
});

it('rejects malformed policies, ids and unexpected arguments without mutating consent', async () => {
  const api = historyHandlers({ history });
  for (const input of [null, [], { enabled: 1, limit: 10 }, { enabled: true, limit: 11 }, { enabled: true, limit: 10, text: 'injected' }]) {
    await expect(api.configureHistory(input)).rejects.toThrow(IpcValidationError);
  }
  await expect(api.configureHistory({ enabled: true, limit: 10 }, 'extra')).rejects.toThrow(IpcValidationError);
  for (const id of [null, 3, '', '../history.json', 'x'.repeat(500)]) await expect(api.deleteHistoryEntry(id)).rejects.toThrow(IpcValidationError);
  await expect(api.getHistory(undefined)).rejects.toThrow(IpcValidationError);
  await expect(api.clearHistory('all')).rejects.toThrow(IpcValidationError);
  expect(await api.getHistory()).toMatchObject({ policy: { enabled: false, limit: 100 }, entries: [] });
});
