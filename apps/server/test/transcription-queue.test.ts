import { ProtocolError } from '@codevo-whisper/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { HttpSttClient } from '../src/stt/http-stt-client';
import { TranscriptionQueue } from '../src/stt/transcription-queue';
import { startFakeSttServer, type FakeSttServer } from './support/fake-stt-server';
import { pcmSeconds } from './support/pcm';
import { waitUntil } from './support/wait-until';

let fake: FakeSttServer | undefined;

afterEach(async () => {
  await fake?.close();
  fake = undefined;
});

const echoFill = (pcm: Uint8Array): { status: number; body: unknown } => ({ status: 200, body: { text: `job-${pcm[0] ?? 0}` } });

async function queueWith(options: { delayMs: number; waitTimeoutMs?: number }): Promise<TranscriptionQueue> {
  fake = await startFakeSttServer({ respond: echoFill, delayMs: options.delayMs });
  return new TranscriptionQueue(new HttpSttClient(fake.url), { waitTimeoutMs: options.waitTimeoutMs ?? 30_000 });
}

describe('TranscriptionQueue', () => {
  it('runs one job at a time', async () => {
    const queue = await queueWith({ delayMs: 30 });
    const results = await Promise.all([1, 2, 3, 4].map((fill) => queue.enqueue(`device-${fill}`, pcmSeconds(0.1, fill), 'sk')));

    expect(results).toEqual(['job-1', 'job-2', 'job-3', 'job-4']);
    expect(fake?.maxActive()).toBe(1);
    expect(queue.size()).toBe(0);
  });

  it('serves devices fairly and times out waiting jobs', async () => {
    const queue = await queueWith({ delayMs: 30 });
    const finished: string[] = [];
    const track = (promise: Promise<string>): Promise<void> => promise.then((text) => void finished.push(text));
    await Promise.all([
      track(queue.enqueue('A', pcmSeconds(0.1, 1), 'sk')),
      track(queue.enqueue('A', pcmSeconds(0.1, 2), 'sk')),
      track(queue.enqueue('A', pcmSeconds(0.1, 3), 'sk')),
      track(queue.enqueue('B', pcmSeconds(0.1, 9), 'sk')),
    ]);

    expect(finished.indexOf('job-9')).toBeLessThan(finished.indexOf('job-3'));
    expect(finished[0]).toBe('job-1');
    expect(finished[1]).toBe('job-9');
    await fake?.close();

    const slow = await queueWith({ delayMs: 300, waitTimeoutMs: 50 });
    const running = slow.enqueue('A', pcmSeconds(0.1, 1), 'sk');
    const waiting = slow.enqueue('B', pcmSeconds(0.1, 2), 'sk');
    expect(slow.size()).toBe(2);

    await expect(waiting).rejects.toMatchObject({ code: 'busy' });
    expect(slow.size()).toBe(1);
    expect(await running).toBe('job-1');
    expect(fake?.requests).toHaveLength(1);
  });

  it('cancelDevice rejects waiting jobs and aborts the running one', async () => {
    const queue = await queueWith({ delayMs: 500 });
    const running = queue.enqueue('A', pcmSeconds(0.1, 1), 'sk');
    const waiting = queue.enqueue('A', pcmSeconds(0.1, 2), 'sk');
    const other = queue.enqueue('B', pcmSeconds(0.1, 3), 'sk');
    await waitUntil(() => fake?.requests.length === 1);
    queue.cancelDevice('A');

    await expect(running).rejects.toMatchObject({ name: 'AbortError' });
    await expect(waiting).rejects.toMatchObject({ name: 'AbortError' });
    expect(await other).toBe('job-3');
    expect(fake?.aborted()).toBe(1);
    expect(fake?.requests).toEqual([
      { language: 'sk', bytes: 3200 },
      { language: 'sk', bytes: 3200 },
    ]);
  });

  it('cancels only the jobs of an aborted signal', async () => {
    const queue = await queueWith({ delayMs: 100 });
    const session = new AbortController();
    const first = queue.enqueue('A', pcmSeconds(0.1, 1), 'sk');
    const cancelled = queue.enqueue('A', pcmSeconds(0.1, 2), 'sk', session.signal);
    const kept = queue.enqueue('A', pcmSeconds(0.1, 3), 'sk');
    session.abort();

    await expect(cancelled).rejects.toMatchObject({ name: 'AbortError' });
    expect(await first).toBe('job-1');
    expect(await kept).toBe('job-3');
    await expect(queue.enqueue('A', pcmSeconds(0.1, 4), 'sk', session.signal)).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('keeps serving after a failed job', async () => {
    fake = await startFakeSttServer({
      respond: (pcm) => (pcm[0] === 1 ? { status: 500, body: {} } : { status: 200, body: { text: 'ok' } }),
    });
    const queue = new TranscriptionQueue(new HttpSttClient(fake.url), { waitTimeoutMs: 1000 });
    const failing = queue.enqueue('A', pcmSeconds(0.1, 1), 'sk');
    const passing = queue.enqueue('A', pcmSeconds(0.1, 2), 'sk');

    await expect(failing).rejects.toBeInstanceOf(ProtocolError);
    expect(await passing).toBe('ok');
  });
});
