import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { StatsStore } from '../src/main/stats/stats-store';
import type { DayStats } from '../src/shared/stats';
import { RecordingLogger } from './recording-logger';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

let dir: string;
let file: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'cw-stats-'));
  file = join(dir, 'stats.json');
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function at(text: string): () => Date {
  return () => new Date(text);
}

function leaves(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value.flatMap(leaves);
  }
  if (typeof value === 'object' && value !== null) {
    return Object.values(value).flatMap(leaves);
  }
  return [value];
}

async function storedDays(): Promise<DayStats[]> {
  return new StatsStore(file).days();
}

describe('StatsStore', () => {
  it("records into today's counters", async () => {
    const store = new StatsStore(file, at('2026-10-25T14:32:00'));

    await store.record({ words: 12, seconds: 4.5 });
    await store.record({ words: 3, seconds: 1.25 });

    const expected: DayStats[] = [{ date: '2026-10-25', words: 15, dictations: 2, seconds: 5.75 }];
    expect(await store.days()).toEqual(expected);
    expect(await storedDays()).toEqual(expected);
    expect((await stat(file)).mode & 0o777).toBe(0o600);
  });

  it('starts a new day after midnight', async () => {
    let now = new Date('2026-10-25T23:59:30');
    const store = new StatsStore(file, () => now);

    await store.record({ words: 10, seconds: 3 });
    now = new Date('2026-10-26T00:00:10');
    await store.record({ words: 4, seconds: 2 });

    expect(await storedDays()).toEqual([
      { date: '2026-10-25', words: 10, dictations: 1, seconds: 3 },
      { date: '2026-10-26', words: 4, dictations: 1, seconds: 2 },
    ]);
  });

  it('file contains only numbers and dates', async () => {
    const store = new StatsStore(file, at('2026-10-25T09:00:00'));

    await store.record({ words: 7, seconds: 2.5 });

    const text = await readFile(file, 'utf8');
    const values = leaves(JSON.parse(text));
    expect(values.length).toBeGreaterThan(0);
    expect(values.every((value) => typeof value === 'number' || (typeof value === 'string' && DATE_PATTERN.test(value)))).toBe(true);
  });

  it('reset deletes the counters', async () => {
    const store = new StatsStore(file, at('2026-10-25T09:00:00'));
    const changes: DayStats[][] = [];
    store.onChange((days) => changes.push(days));
    await store.record({ words: 7, seconds: 2 });

    await store.reset();

    expect(await store.days()).toEqual([]);
    await expect(stat(file)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(changes).toEqual([[{ date: '2026-10-25', words: 7, dictations: 1, seconds: 2 }], []]);
  });

  it('corrupt file starts empty', async () => {
    const logger = new RecordingLogger();
    await writeFile(file, '{ not json');
    const store = new StatsStore(file, at('2026-10-25T09:00:00'), logger);

    expect(await store.days()).toEqual([]);
    expect(logger.errors).toHaveLength(1);

    await writeFile(file, JSON.stringify({ version: 1, days: [{ date: 'yesterday', words: 'many', dictations: 1, seconds: 1 }] }));
    const invalid = new StatsStore(file, at('2026-10-25T09:00:00'), logger);
    expect(await invalid.days()).toEqual([]);
    expect(logger.errors).toHaveLength(2);

    await invalid.record({ words: 2, seconds: 1 });
    expect(await storedDays()).toEqual([{ date: '2026-10-25', words: 2, dictations: 1, seconds: 1 }]);
  });
});
