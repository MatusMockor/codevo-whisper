import { describe, expect, it } from 'vitest';
import { SegmentFailedError, SessionCancelledError } from '../../src/session/session-errors';
import { ControllableTranscriber, flush } from '../support/controllable-transcriber';
import { concatSamples, loadFixture, toBytes } from '../support/fixtures';
import { ImmediateTranscriber } from '../support/immediate-transcriber';
import { feed, harness } from '../support/session-harness';

const speech = loadFixture('speech-pauses');
const continuous = loadFixture('speech-continuous');
const long = concatSamples(continuous, continuous, continuous);

describe('RollingSession', () => {
  it('Indikátor mode never requests partials', async () => {
    const engine = new ImmediateTranscriber();
    const { clock, open } = harness(engine);
    const { session, events } = open('a', false);

    await feed(clock, [session], speech);
    await session.finish();

    expect(events.map((event) => event.type)).toEqual(['final']);
    expect(engine.lengths).toEqual([speech.length * 2]);
  });

  it('emits partials with increasing revisions about once per second', async () => {
    const { clock, open } = harness(new ImmediateTranscriber());
    const { session, events } = open('a', true);

    await feed(clock, [session], speech);
    await session.finish();
    const partials = events.filter((event) => event.type === 'partial');
    const final = events.at(-1);

    expect(partials.length).toBeGreaterThanOrEqual(9);
    expect(partials.length).toBeLessThanOrEqual(12);
    expect(partials.map((event) => event.revision)).toEqual(partials.map((_, index) => index + 1));
    expect(final).toMatchObject({ type: 'final', segmentId: 0, revision: partials.length + 1 });
  });

  it('a partial in flight at finish does not overwrite the final', async () => {
    const engine = new ControllableTranscriber();
    const { clock, open } = harness(engine);
    const { session, events } = open('a', true);

    await feed(clock, [session], speech, 0, 24000);
    expect(engine.calls).toHaveLength(1);
    const done = session.finish();
    engine.call(0).resolve('neskorý partial');
    await flush();
    engine.call(1).resolve('finálny text');

    await expect(done).resolves.toBe('finálny text');
    expect(events).toEqual([{ type: 'final', segmentId: 0, revision: 2, text: 'finálny text' }]);
  });

  it('finish resolves the joined text and final events carry ids 0..n', async () => {
    const { clock, open } = harness(new ImmediateTranscriber((_, call) => ['prvý úsek', 'druhý kus'][call] ?? ''));
    const { session, events } = open('a', false);

    await feed(clock, [session], long);

    await expect(session.finish()).resolves.toBe('prvý úsek druhý kus');
    expect(events.map((event) => [event.type, event.segmentId])).toEqual([
      ['final', 0],
      ['final', 1],
    ]);
  });

  it('commits segments while recording, before finish', async () => {
    const engine = new ImmediateTranscriber();
    const { clock, open } = harness(engine);
    const { session, events } = open('a', false);

    await feed(clock, [session], long);

    expect(events).toHaveLength(1);
    expect(engine.lengths[0]).toBeLessThanOrEqual(25 * 32000);
    await session.finish();
  });

  it('rejects finish with SegmentFailedError keeping the text so far', async () => {
    const engine = new ControllableTranscriber();
    const { clock, open } = harness(engine);
    const { session } = open('a', false);

    await feed(clock, [session], long);
    engine.call(0).reject(new Error('engine crashed'));
    const done = session.finish();
    await flush();
    engine.call(1).resolve('koniec');

    const error: unknown = await done.catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(SegmentFailedError);
    expect(error).toMatchObject({ segmentId: 0, textSoFar: 'koniec' });
  });

  it('cancel rejects finish and ignores late results', async () => {
    const engine = new ControllableTranscriber();
    const { clock, open } = harness(engine);
    const { session, events } = open('a', true);

    await feed(clock, [session], speech, 0, 32000);
    const done = session.finish();
    session.cancel();

    await expect(done).rejects.toBeInstanceOf(SessionCancelledError);
    engine.calls.forEach((call) => call.resolve('neskoro'));
    await flush();
    expect(events).toEqual([]);
    expect(() => session.push(toBytes(speech.subarray(0, 1600)))).toThrow();
  });

  it('cancel while recording cancels queued jobs of the device', async () => {
    const engine = new ControllableTranscriber();
    const { clock, open } = harness(engine);
    const { session } = open('a', true);

    await feed(clock, [session], speech, 0, 24000);
    session.cancel();

    expect(engine.call(0).signal.aborted).toBe(true);
  });

  it('two devices both receive partials and their finals come before pending partials', async () => {
    const engine = new ControllableTranscriber();
    const { clock, open } = harness(engine);
    const a = open('a', true);
    const b = open('b', true);
    const sessions = [a.session, b.session];

    await feed(clock, sessions, speech, 0, 32000);
    expect(engine.calls).toHaveLength(1);
    engine.call(0).resolve('a1');
    await flush();
    engine.call(1).resolve('b1');
    await flush();

    await feed(clock, sessions, speech, 32000, 64000);
    const finishA = a.session.finish();
    engine.call(2).resolve('a2');
    await flush();
    engine.call(3).resolve('a-final');
    await expect(finishA).resolves.toBe('a-final');
    expect(b.events.map((event) => event.text)).toEqual(['b1']);

    await flush();
    engine.call(4).resolve('b2');
    await flush();
    const finishB = b.session.finish();
    await flush();
    engine.call(5).resolve('b-final');
    await expect(finishB).resolves.toBe('b-final');

    expect(a.events.map((event) => [event.type, event.text])).toEqual([
      ['partial', 'a1'],
      ['final', 'a-final'],
    ]);
    expect(b.events.map((event) => [event.type, event.text])).toEqual([
      ['partial', 'b1'],
      ['partial', 'b2'],
      ['final', 'b-final'],
    ]);
  });

  it('push after finish throws', async () => {
    const { clock, open } = harness(new ImmediateTranscriber());
    const { session } = open('a', false);
    await feed(clock, [session], speech, 0, 16000);
    await session.finish();

    expect(() => session.push(new Uint8Array(2))).toThrow();
  });

  it('an empty dictation resolves to an empty text without engine calls', async () => {
    const engine = new ImmediateTranscriber();
    const { open } = harness(engine);

    await expect(open('a', true).session.finish()).resolves.toBe('');
    expect(engine.lengths).toEqual([]);
  });
});
