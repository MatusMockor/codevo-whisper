import { assert, describe, expect, it } from 'vitest';
import { FairJobQueue } from '../../src/scheduling/fair-job-queue';
import type { JobKind, TranscriptionJob } from '../../src/scheduling/transcription-job';

type Entry = { job: TranscriptionJob; name: string };

let counter = 0;

function entry(deviceId: string, kind: JobKind, sessionId = `${deviceId}-session`): Entry {
  counter += 1;
  return {
    job: { sessionId, deviceId, kind, segmentId: 0, revision: counter, pcm: new Uint8Array(0), context: { language: 'sk' } },
    name: `${sessionId}:${kind}:${counter}`,
  };
}

function takeDefined(queue: FairJobQueue<Entry>): Entry {
  const next = queue.take();
  assert.isDefined(next);
  return next;
}

function drain(queue: FairJobQueue<Entry>): Entry[] {
  const served: Entry[] = [];
  while (queue.size > 0) {
    const next = takeDefined(queue);
    served.push(next);
    queue.complete(next);
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
    const finals = [entry('a', 'final'), entry('a', 'final'), entry('a', 'final')];
    finals.forEach((final) => queue.offer(final));

    expect(drain(queue)).toEqual(finals);
  });

  it('serves finals round-robin across devices', () => {
    const queue = new FairJobQueue<Entry>();
    const a0 = entry('a', 'final');
    const a1 = entry('a', 'final');
    const b0 = entry('b', 'final');
    [a0, a1, b0].forEach((final) => queue.offer(final));

    expect(drain(queue)).toEqual([a0, b0, a1]);
  });

  it('serves partials round-robin across devices', () => {
    const queue = new FairJobQueue<Entry>();
    const served: string[] = [];
    ['a', 'b', 'c'].forEach((device) => queue.offer(entry(device, 'partial')));
    for (let round = 0; round < 6; round += 1) {
      const next = takeDefined(queue);
      served.push(next.job.deviceId);
      queue.complete(next);
      queue.offer(entry(next.job.deviceId, 'partial'));
    }

    expect(served).toEqual(['a', 'b', 'c', 'a', 'b', 'c']);
  });

  it('rejects a partial while the session partial is running', () => {
    const queue = new FairJobQueue<Entry>();
    queue.offer(entry('a', 'partial'));
    queue.take();
    const late = entry('a', 'partial');

    expect(queue.offer(late)).toEqual([{ entry: late, reason: 'partial-in-flight' }]);
    expect(queue.size).toBe(0);
  });

  it('rejects a partial while the session is finalizing', () => {
    const queue = new FairJobQueue<Entry>();
    queue.offer(entry('a', 'final'));
    const queuedFinal = entry('a', 'partial');
    expect(queue.offer(queuedFinal)).toEqual([{ entry: queuedFinal, reason: 'finalizing' }]);

    queue.take();
    const runningFinal = entry('a', 'partial');
    expect(queue.offer(runningFinal)).toEqual([{ entry: runningFinal, reason: 'finalizing' }]);
  });

  it('a finishing session does not block partials of a newer session on the same device', () => {
    const queue = new FairJobQueue<Entry>();
    queue.offer(entry('local', 'final', 'first'));
    queue.take();
    const partial = entry('local', 'partial', 'second');

    expect(queue.offer(partial)).toEqual([]);
  });

  it('replaces a pending partial with a newer one', () => {
    const queue = new FairJobQueue<Entry>();
    const older = entry('a', 'partial');
    const newer = entry('a', 'partial');
    queue.offer(older);

    expect(queue.offer(newer)).toEqual([{ entry: older, reason: 'replaced' }]);
    expect(drain(queue)).toEqual([newer]);
  });

  it('a final supersedes the pending partial of the same session', () => {
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

  it('accepts partials again after the session final completed', () => {
    const queue = new FairJobQueue<Entry>();
    queue.offer(entry('a', 'final'));
    drain(queue);

    expect(queue.offer(entry('a', 'partial'))).toEqual([]);
  });

  it('removeSession cancels only the jobs of that session', () => {
    const queue = new FairJobQueue<Entry>();
    const cancelled = entry('local', 'final', 'first');
    const kept = entry('local', 'final', 'second');
    const other = entry('b', 'partial');
    [cancelled, kept, other].forEach((job) => queue.offer(job));

    expect(queue.removeSession('first')).toEqual([{ entry: cancelled, reason: 'cancelled' }]);
    expect(drain(queue)).toEqual([kept, other]);
  });

  it('forgets a released session once its jobs completed and prunes its empty lane', () => {
    const queue = new FairJobQueue<Entry>();
    queue.offer(entry('a', 'final', 'first'));
    const running = takeDefined(queue);
    queue.releaseSession('first');
    expect(queue.stats()).toEqual({ sessions: 1, lanes: 1 });

    queue.complete(running);

    expect(queue.stats()).toEqual({ sessions: 0, lanes: 0 });
  });

  it('releasing an idle session forgets it at once and keeps lanes with work', () => {
    const queue = new FairJobQueue<Entry>();
    queue.offer(entry('local', 'final', 'first'));
    drain(queue);
    queue.offer(entry('local', 'final', 'second'));

    queue.releaseSession('first');

    expect(queue.stats()).toEqual({ sessions: 1, lanes: 1 });
  });

  it('removeQueued drops only queued jobs and keeps the running one accounted', () => {
    const queue = new FairJobQueue<Entry>();
    queue.offer(entry('a', 'partial', 's'));
    const running = takeDefined(queue);
    const queuedFinal = entry('a', 'final', 's');
    queue.offer(queuedFinal);
    const other = entry('b', 'final', 'other');
    queue.offer(other);

    expect(queue.removeQueued('s')).toEqual([{ entry: queuedFinal, reason: 'cancelled' }]);
    expect(queue.offer(entry('a', 'partial', 's'))).toMatchObject([{ reason: 'partial-in-flight' }]);
    queue.releaseSession('s');
    expect(queue.stats().sessions).toBe(2);
    queue.complete(running);
    expect(drain(queue)).toEqual([other]);
    queue.releaseSession('other');
    expect(queue.stats()).toEqual({ sessions: 0, lanes: 0 });
  });

  it('removeSession prunes lanes left empty', () => {
    const queue = new FairJobQueue<Entry>();
    queue.offer(entry('a', 'final', 'first'));
    queue.removeSession('first');

    expect(queue.stats()).toEqual({ sessions: 0, lanes: 0 });
  });

  it('completing a job of a removed session does not change another session', () => {
    const queue = new FairJobQueue<Entry>();
    queue.offer(entry('local', 'final', 'first'));
    const old = takeDefined(queue);
    queue.removeSession('first');
    queue.offer(entry('local', 'final', 'second'));
    takeDefined(queue);
    queue.complete(old);
    const partial = entry('local', 'partial', 'second');

    expect(queue.offer(partial)).toEqual([{ entry: partial, reason: 'finalizing' }]);
  });
});
