import { describe, expect, it } from 'vitest';
import { wordsMatch } from '../../src/dedup/words-match';
import { concatSamples, loadFixture } from '../support/fixtures';
import { feed, harness } from '../support/session-harness';
import { addWhiteNoise } from '../support/signals';
import { TimelineTranscriber, type TimelineMode } from '../support/timeline-transcriber';

function distinctVocabulary(words: string[]): boolean {
  return words.every((word, index) => words.slice(index + 1).every((other) => !wordsMatch(word, other)));
}

async function transcribeEndToEnd(audio: Int16Array, mode: TimelineMode, partials: boolean): Promise<{ text: string; expected: string; finals: number }> {
  const engine = new TimelineTranscriber(audio, mode);
  const { clock, open } = harness(engine);
  const { session, events } = open('a', partials);
  expect(distinctVocabulary(engine.vocabulary(audio.length))).toBe(true);
  await feed(clock, [session], audio);
  const text = await session.finish();
  return { text, expected: engine.expectedText(audio.length), finals: events.filter((event) => event.type === 'final').length };
}

const continuous = loadFixture('speech-continuous');
const speech = loadFixture('speech-pauses');
const continuousAudio = addWhiteNoise(concatSamples(continuous, continuous, continuous), 30, 11);
const pauseAudio = addWhiteNoise(concatSamples(speech, speech, speech), 30, 13);

describe('RollingSession on recorded speech', () => {
  it('continuous speech end to end has no duplicated or missing words', async () => {
    const result = await transcribeEndToEnd(continuousAudio, {}, true);

    expect(result.text).toBe(result.expected);
    expect(result.finals).toBe(2);
  });

  it('a word truncated at the hard cut is replaced by the full word of the next segment', async () => {
    const result = await transcribeEndToEnd(continuousAudio, { truncateAtCut: true }, false);

    expect(result.text).toBe(result.expected);
  });

  it('a pre-roll fragment at the start of the next segment is removed', async () => {
    const result = await transcribeEndToEnd(continuousAudio, { fragmentAtStart: true }, false);

    expect(result.text).toBe(result.expected);
  });

  it('fast speech with five words per second in the overlap is deduped', async () => {
    const result = await transcribeEndToEnd(continuousAudio, { wordMs: 200, truncateAtCut: true, fragmentAtStart: true }, true);

    expect(result.text).toBe(result.expected);
  });

  it('pause fixture end to end commits at a pause and keeps every word', async () => {
    const result = await transcribeEndToEnd(pauseAudio, { fragmentAtStart: true }, false);

    expect(result.text).toBe(result.expected);
    expect(result.finals).toBeGreaterThanOrEqual(2);
  });

  it('pause fixture with fast speech keeps every word', async () => {
    const result = await transcribeEndToEnd(pauseAudio, { wordMs: 200, fragmentAtStart: true }, true);

    expect(result.text).toBe(result.expected);
  });
});
