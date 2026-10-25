import { describe, expect, it } from 'vitest';
import type { JobOutcome } from '../../src/scheduling/job-outcome';
import { TranscriptionDispatcher } from '../../src/scheduling/transcription-dispatcher';
import type { JobKind, TranscriptionJob } from '../../src/scheduling/transcription-job';
import { ControllableTranscriber, flush } from '../support/controllable-transcriber';
import { ManualClock } from '../support/manual-clock';

function job(deviceId: string, kind: JobKind, marker: number, sessionId = `${deviceId}-session`, language = 'sk'): TranscriptionJob {
  return { sessionId, deviceId, kind, segmentId: 0, revision: 1, pcm: new Uint8Array([marker]), context: { language } };
}

function setup(): { dispatcher: TranscriptionDispatcher; engine: ControllableTranscriber; clock: ManualClock } {
  const engine = new ControllableTranscriber();
  const clock = new ManualClock();
  return { dispatcher: new TranscriptionDispatcher({ transcriber: engine, clock }), engine, clock };
}

function markers(engine: ControllableTranscriber): number[] {
  return engine.calls.map((call) => call.pcm[0] ?? -1);
}

describe('TranscriptionDispatcher', () => {
  it('runs one call at a time', async () => {
    const { dispatcher, engine } = setup();
    const first = dispatcher.submit(job('a', 'final', 1));
    void dispatcher.submit(job('b', 'final', 2));

    expect(markers(engine)).toEqual([1]);
    engine.call(0).resolve('prvý');
    await expect(first).resolves.toEqual({ status: 'done', text: 'prvý' });
    await flush();
    expect(markers(engine)).toEqual([1, 2]);
  });

  it('a final submitted while a partial runs is served next before queued partials', async () => {
    const { dispatcher, engine } = setup();
    void dispatcher.submit(job('a', 'partial', 1));
    void dispatcher.submit(job('b', 'partial', 2));
    void dispatcher.submit(job('c', 'final', 3));

    engine.call(0).resolve('');
    await flush();
    expect(markers(engine)).toEqual([1, 3]);
    engine.call(1).resolve('');
    await flush();
    expect(markers(engine)).toEqual([1, 3, 2]);
  });

  it('drops a partial while the same device partial is in flight', async () => {
    const { dispatcher } = setup();
    void dispatcher.submit(job('a', 'partial', 1));

    await expect(dispatcher.submit(job('a', 'partial', 2))).resolves.toEqual({ status: 'dropped', reason: 'partial-in-flight' });
  });

  it('partials of two devices alternate', async () => {
    const { dispatcher, engine } = setup();
    void dispatcher.submit(job('a', 'partial', 1));
    void dispatcher.submit(job('a', 'partial', 2));
    void dispatcher.submit(job('b', 'partial', 3));
    engine.call(0).resolve('');
    await flush();
    void dispatcher.submit(job('a', 'partial', 4));
    engine.call(1).resolve('');
    await flush();

    expect(markers(engine)).toEqual([1, 3, 4]);
  });

  it('resolves failed when the engine throws', async () => {
    const { dispatcher, engine } = setup();
    const outcome = dispatcher.submit(job('a', 'final', 1));
    const error = new Error('engine crashed');
    engine.call(0).reject(error);

    await expect(outcome).resolves.toEqual({ status: 'failed', error });
  });

  it('passes the whole job with its context to the engine', async () => {
    const { dispatcher, engine } = setup();
    void dispatcher.submit(job('a', 'final', 1, 'a-session', 'sk'));
    void dispatcher.submit(job('b', 'final', 2, 'b-session', 'en'));
    engine.call(0).resolve('');
    await flush();

    expect(engine.calls.map((call) => [call.job.sessionId, call.job.context.language])).toEqual([
      ['a-session', 'sk'],
      ['b-session', 'en'],
    ]);
  });

  it('cancelSession aborts only that session on a shared device', async () => {
    const { dispatcher, engine } = setup();
    const first = dispatcher.submit(job('local', 'final', 1, 'first'));
    const second = dispatcher.submit(job('local', 'final', 2, 'second'));

    dispatcher.cancelSession('second');

    expect(engine.call(0).signal.aborted).toBe(false);
    await expect(second).resolves.toEqual({ status: 'dropped', reason: 'cancelled' });
    engine.call(0).resolve('prvá');
    await expect(first).resolves.toEqual({ status: 'done', text: 'prvá' });
  });

  it('cancelSession aborts the in-flight call and drops queued jobs', async () => {
    const { dispatcher, engine } = setup();
    const running = dispatcher.submit(job('a', 'final', 1));
    const queued = dispatcher.submit(job('a', 'final', 2));
    const other = dispatcher.submit(job('b', 'final', 3));

    dispatcher.cancelSession('a-session');

    expect(engine.call(0).signal.aborted).toBe(true);
    await expect(running).resolves.toEqual({ status: 'dropped', reason: 'cancelled' });
    await expect(queued).resolves.toEqual({ status: 'dropped', reason: 'cancelled' });
    await flush();
    expect(markers(engine)).toEqual([1, 3]);
    engine.call(1).resolve('b');
    await expect(other).resolves.toEqual({ status: 'done', text: 'b' });
  });

  it('partial interval grows with attached live devices', () => {
    const { dispatcher } = setup();
    const interval = dispatcher.partialIntervalSource();
    dispatcher.attach('a', true);
    expect(interval.partialIntervalMs()).toBe(1000);

    const b = dispatcher.attach('b', true);
    dispatcher.attach('c', false);
    expect(interval.partialIntervalMs()).toBe(2000);

    dispatcher.detach(b);
    expect(interval.partialIntervalMs()).toBe(1000);
  });

  it('counts a device once however many sessions it has and returns distinct session ids', () => {
    const { dispatcher } = setup();
    const first = dispatcher.attach('local', true);
    const second = dispatcher.attach('local', true);
    dispatcher.attach('remote', true);

    expect(first).not.toBe(second);
    expect(dispatcher.partialIntervalSource().partialIntervalMs()).toBe(2000);
    dispatcher.detach(first);
    expect(dispatcher.partialIntervalSource().partialIntervalMs()).toBe(2000);
    dispatcher.detach(second);
    expect(dispatcher.partialIntervalSource().partialIntervalMs()).toBe(1000);
  });

  it('service time feeds the interval', async () => {
    const { dispatcher, engine, clock } = setup();
    dispatcher.attach('a', true);
    const outcome = dispatcher.submit(job('a', 'partial', 1));
    clock.advance(1100);
    engine.call(0).resolve('text');
    await outcome;

    expect(dispatcher.partialIntervalSource().partialIntervalMs()).toBe(2000);
  });

  it('whenIdle resolves after the queue drains', async () => {
    const { dispatcher, engine } = setup();
    const outcomes: JobOutcome[] = [];
    void dispatcher.submit(job('a', 'final', 1)).then((outcome) => outcomes.push(outcome));
    void dispatcher.submit(job('a', 'final', 2)).then((outcome) => outcomes.push(outcome));
    const idle = dispatcher.whenIdle();
    engine.call(0).resolve('1');
    await flush();
    engine.call(1).resolve('2');
    await idle;

    expect(outcomes).toHaveLength(2);
  });

  it('does not retain finished or cancelled sessions', async () => {
    const engine = new ControllableTranscriber();
    const dispatcher = new TranscriptionDispatcher({ transcriber: engine, clock: new ManualClock() });
    for (let index = 0; index < 50; index += 1) {
      const sessionId = dispatcher.attach(`device-${index % 3}`, true);
      const outcome = dispatcher.submit(job(`device-${index % 3}`, 'final', index, sessionId));
      await flush();
      engine.call(index).resolve('');
      await outcome;
      dispatcher.detach(sessionId);
    }
    const cancelled = dispatcher.attach('gone', true);
    void dispatcher.submit(job('gone', 'final', 99, cancelled));
    dispatcher.cancelSession(cancelled);
    dispatcher.detach(cancelled);
    await dispatcher.whenIdle();

    expect(dispatcher.queueStats()).toEqual({ sessions: 0, lanes: 0 });
  });

  it('whenIdle resolves at once when nothing runs', async () => {
    await expect(setup().dispatcher.whenIdle()).resolves.toBeUndefined();
  });
});
