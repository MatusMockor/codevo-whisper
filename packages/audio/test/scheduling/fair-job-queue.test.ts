import { describe, expect, it } from 'vitest';
import { FairJobQueue } from '../../src/scheduling/fair-job-queue';
import type { JobKind, TranscriptionJob } from '../../src/scheduling/transcription-job';

type Entry = { job: TranscriptionJob; name: string };

let counter = 0;

function entry(deviceId: string, kind: JobKind, segmentId = 0): Entry {
  counter += 1;
  return { job: { deviceId, kind, segmentId, revision: counter, pcm: new Uint8Array(0) }, name: `${deviceId}:${kind}:${counter}` };
}

function drain(queue: FairJobQueue<Entry>): Entry[] {
  const served: Entry[] = [];
  let next = queue.take();
  while (next !== undefined) {
    served.push(next);
    queue.complete(next);
    next = queue.take();
  }
  return served;
}

describe('FairJobQueue', () => {
  it('serves finals before partials', () => {
    const queue = new FairJobQueue<Entry>();
    const partial = entry('a', 'partial');
    const final = entry('b', 'final');
    queue.offer(partial);
    queue.offer(final);

    expect(drain(queue)).toEqual([final, partial]);
  });

  it('keeps finals of one device in order', () => {
    const queue = new FairJobQueue<Entry>();
    const finals = [entry('a', 'final', 0), entry('a', 'final', 1), entry('a', 'final', 2)];
    finals.forEach((final) => queue.offer(final));

    expect(drain(queue)).toEqual(finals);
  });

  it('serves finals round-robin across devices', () => {
    const queue = new FairJobQueue<Entry>();
    const a0 = entry('a', 'final', 0);
    const a1 = entry('a', 'final', 1);
    const b0 = entry('b', 'final', 0);
    [a0, a1, b0].forEach((final) => queue.offer(final));

    expect(drain(queue)).toEqual([a0, b0, a1]);
  });

  it('serves partials round-robin across devices', () => {
    const queue = new FairJobQueue<Entry>();
    const served: string[] = [];
    ['a', 'b', 'c'].forEach((device) => queue.offer(entry(device, 'partial')));
    for (let round = 0; round < 6; round += 1) {
      const next = queue.take();
      expect(next).toBeDefined();
      if (next === undefined) {
        return;
      }
      served.push(next.job.deviceId);
      queue.complete(next);
      queue.offer(entry(next.job.deviceId, 'partial'));
    }

    expect(served).toEqual(['a', 'b', 'c', 'a', 'b', 'c']);
  });

  it('rejects a partial while the device partial is running', () => {
    const queue = new FairJobQueue<Entry>();
    queue.offer(entry('a', 'partial'));
    queue.take();
    const late = entry('a', 'partial');

    expect(queue.offer(late)).toEqual([{ entry: late, reason: 'partial-in-flight' }]);
    expect(queue.size).toBe(0);
  });

  it('rejects a partial while the device is finalizing', () => {
    const queue = new FairJobQueue<Entry>();
    queue.offer(entry('a', 'final'));
    const queuedFinal = entry('a', 'partial');
    expect(queue.offer(queuedFinal)).toEqual([{ entry: queuedFinal, reason: 'finalizing' }]);

    queue.take();
    const runningFinal = entry('a', 'partial');
    expect(queue.offer(runningFinal)).toEqual([{ entry: runningFinal, reason: 'finalizing' }]);
  });

  it('replaces a pending partial with a newer one', () => {
    const queue = new FairJobQueue<Entry>();
    const older = entry('a', 'partial');
    const newer = entry('a', 'partial');
    queue.offer(older);

    expect(queue.offer(newer)).toEqual([{ entry: older, reason: 'replaced' }]);
    expect(drain(queue)).toEqual([newer]);
  });

  it('a final supersedes the pending partial of the same device', () => {
    const queue = new FairJobQueue<Entry>();
    const partial = entry('a', 'partial');
    const final = entry('a', 'final');
    queue.offer(partial);

    expect(queue.offer(final)).toEqual([{ entry: partial, reason: 'superseded' }]);
    expect(drain(queue)).toEqual([final]);
  });

  it('a pending partial of another device survives a final', () => {
    const queue = new FairJobQueue<Entry>();
    const partial = entry('b', 'partial');
    const final = entry('a', 'final');
    queue.offer(partial);

    expect(queue.offer(final)).toEqual([]);
    expect(drain(queue)).toEqual([final, partial]);
  });

  it('accepts partials again after the device final completed', () => {
    const queue = new FairJobQueue<Entry>();
    queue.offer(entry('a', 'final'));
    drain(queue);

    expect(queue.offer(entry('a', 'partial'))).toEqual([]);
  });

  it('removeDevice cancels queued jobs and keeps other devices', () => {
    const queue = new FairJobQueue<Entry>();
    const final = entry('a', 'final');
    const other = entry('b', 'partial');
    queue.offer(final);
    queue.offer(other);

    expect(queue.removeDevice('a')).toEqual([{ entry: final, reason: 'cancelled' }]);
    expect(drain(queue)).toEqual([other]);
  });
});
