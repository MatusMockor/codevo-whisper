import { describe, expect, it } from 'vitest';
import { attributeSpeakers } from '../src/main/meetings/attribute-speakers';

const word = (t0Ms: number, t1Ms: number, text: string) => ({ t0Ms, t1Ms, text });

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
});
