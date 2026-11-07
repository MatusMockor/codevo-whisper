import { describe, expect, it } from 'vitest';
import { attributeSpeakers } from '../src/main/meetings/attribute-speakers';

const word = (t0Ms: number, t1Ms: number, text: string) => ({ t0Ms, t1Ms, text });
const segment = (t0Ms: number, t1Ms: number, speaker: number) => ({ t0Ms, t1Ms, speaker });
const said = (turns: { speaker: string; text: string }[]) => turns.map((turn) => `${turn.speaker}:${turn.text}`);

describe('attributeSpeakers', () => {
  it('labels mic words Ja and system words Ostatní on one clock', () => {
    const turns = attributeSpeakers([
      { track: 'mic', startOffsetMs: 0, words: [word(0, 400, 'Ahoj'), word(500, 900, 'všetci')] },
      { track: 'system', startOffsetMs: 1000, words: [word(500, 900, 'Dobrý'), word(1000, 1300, 'deň')] },
    ]);

    expect(turns).toEqual([
      { speaker: 'Ja', t0Ms: 0, t1Ms: 900, text: 'Ahoj všetci' },
      { speaker: 'Ostatní', t0Ms: 1500, t1Ms: 2300, text: 'Dobrý deň' },
    ]);
  });

  it('starts a new turn after a pause of 2 s or when the speaker changes back', () => {
    const turns = attributeSpeakers([
      { track: 'mic', startOffsetMs: 0, words: [word(0, 500, 'jedna'), word(2500, 3000, 'dva'), word(6000, 6500, 'štyri')] },
      { track: 'system', startOffsetMs: 0, words: [word(4000, 4500, 'tri')] },
    ]);

    expect(turns.map((turn) => `${turn.speaker}:${turn.text}`)).toEqual(['Ja:jedna', 'Ja:dva', 'Ostatní:tri', 'Ja:štyri']);
  });

  it('keeps words closer than 2 s in one turn', () => {
    const turns = attributeSpeakers([{ track: 'system', startOffsetMs: 0, words: [word(0, 500, 'a'), word(2400, 2600, 'b')] }]);

    expect(turns).toEqual([{ speaker: 'Ostatní', t0Ms: 0, t1Ms: 2600, text: 'a b' }]);
  });

  it('returns no turns without words', () => {
    expect(attributeSpeakers([{ track: 'mic', startOffsetMs: 0, words: [] }])).toEqual([]);
  });

  it('gives a system word to the speaker segment that contains its midpoint', () => {
    const turns = attributeSpeakers([
      { track: 'system', startOffsetMs: 0, words: [word(1800, 2600, 'prvý'), word(3000, 3400, 'druhý')], segments: [segment(0, 2100, 1), segment(2900, 5000, 2)] },
    ]);

    expect(said(turns)).toEqual(['Hovoriaci 1:prvý', 'Hovoriaci 2:druhý']);
  });

  it('falls back to the nearest segment within 1 s, then to Ostatní', () => {
    const turns = attributeSpeakers([
      {
        track: 'system',
        startOffsetMs: 0,
        words: [word(0, 400, 'a'), word(5000, 5400, 'b'), word(6100, 6300, 'blízko'), word(9000, 9400, 'ďaleko')],
        segments: [segment(0, 500, 1), segment(4900, 5500, 2)],
      },
    ]);

    expect(said(turns)).toEqual(['Hovoriaci 1:a', 'Hovoriaci 2:b blízko', 'Ostatní:ďaleko']);
  });

  it('numbers speakers in order of first appearance', () => {
    const turns = attributeSpeakers([
      { track: 'system', startOffsetMs: 0, words: [word(0, 400, 'skôr'), word(5000, 5400, 'neskôr')], segments: [segment(0, 500, 3), segment(4900, 5500, 1)] },
    ]);

    expect(said(turns)).toEqual(['Hovoriaci 1:skôr', 'Hovoriaci 2:neskôr']);
  });

  it('keeps Ostatní when only one speaker is found among the system words', () => {
    const turns = attributeSpeakers([
      { track: 'system', startOffsetMs: 0, words: [word(0, 400, 'iba'), word(9000, 9400, 'jeden')], segments: [segment(0, 500, 1), segment(20_000, 21_000, 2)] },
    ]);

    expect(said(turns)).toEqual(['Ostatní:iba', 'Ostatní:jeden']);
  });

  it('matches system words to segments on the track clock and merges them with mic words', () => {
    const turns = attributeSpeakers([
      { track: 'mic', startOffsetMs: 0, words: [word(2500, 2900, 'ja')] },
      { track: 'system', startOffsetMs: 2000, words: [word(0, 400, 'one'), word(3000, 3400, 'two')], segments: [segment(0, 500, 1), segment(2900, 3500, 2)] },
    ]);

    expect(turns).toEqual([
      { speaker: 'Hovoriaci 1', t0Ms: 2000, t1Ms: 2400, text: 'one' },
      { speaker: 'Ja', t0Ms: 2500, t1Ms: 2900, text: 'ja' },
      { speaker: 'Hovoriaci 2', t0Ms: 5000, t1Ms: 5400, text: 'two' },
    ]);
  });
});
