import { describe, expect, it } from 'vitest';
import { wordsMatch } from '../../src/dedup/words-match';
import { concatSamples, loadFixture } from '../support/fixtures';
import { feed, harness } from '../support/session-harness';
import { addWhiteNoise } from '../support/signals';
import { TimelineTranscriber } from '../support/timeline-transcriber';

function distinctVocabulary(words: string[]): boolean {
  return words.every((word, index) => words.slice(index + 1).every((other) => !wordsMatch(word, other)));
}

describe('RollingSession on recorded speech', () => {
  it('continuous speech end to end has no duplicated or missing words', async () => {
    const continuous = loadFixture('speech-continuous');
    const audio = addWhiteNoise(concatSamples(continuous, continuous, continuous), 30, 11);
    const engine = new TimelineTranscriber(audio);
    const { clock, open } = harness(engine);
    const { session, events } = open('a', true);

    expect(distinctVocabulary(engine.vocabulary(audio.length))).toBe(true);
    await feed(clock, [session], audio);
    const text = await session.finish();

    expect(text).toBe(engine.expectedText(audio.length));
    expect(events.filter((event) => event.type === 'final').map((event) => event.segmentId)).toEqual([0, 1]);
  });

  it('pause fixture end to end commits at a pause and keeps every word', async () => {
    const speech = loadFixture('speech-pauses');
    const audio = addWhiteNoise(concatSamples(speech, speech, speech), 30, 13);
    const engine = new TimelineTranscriber(audio);
    const { clock, open } = harness(engine);
    const { session, events } = open('a', false);

    await feed(clock, [session], audio);
    const text = await session.finish();

    expect(text).toBe(engine.expectedText(audio.length));
    expect(events.filter((event) => event.type === 'final').length).toBeGreaterThanOrEqual(2);
  });
});
