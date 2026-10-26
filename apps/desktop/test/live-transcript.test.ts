import { describe, expect, it } from 'vitest';
import type { TranscriptUpdate } from '../src/main/engines/transcription-engine';
import { LIVE_TEXT_CHARS, LiveTranscript } from '../src/main/session/live-transcript';

function applied(...updates: TranscriptUpdate[]): LiveTranscript {
  const live = new LiveTranscript();
  for (const update of updates) {
    live.apply(update);
  }
  return live;
}

function partial(segmentId: number, revision: number, text: string): TranscriptUpdate {
  return { type: 'partial', segmentId, revision, text };
}

function final(segmentId: number, text: string): TranscriptUpdate {
  return { type: 'final', segmentId, text };
}

describe('LiveTranscript', () => {
  it('starts empty', () => {
    expect(new LiveTranscript().view()).toEqual({ confirmed: '', tentative: '' });
  });

  it('shows the first partial of a segment as tentative', () => {
    expect(applied(partial(0, 1, 'ahoj Peter pozrel')).view()).toEqual({ confirmed: '', tentative: 'ahoj Peter pozrel' });
  });

  it('confirms the words a partial shares with the previous partial of the segment', () => {
    const live = applied(partial(0, 1, 'ahoj Peter pozrel som'), partial(0, 2, 'ahoj Peter pozrel som si ten pull'));

    expect(live.view()).toEqual({ confirmed: 'ahoj Peter pozrel som', tentative: 'si ten pull' });
  });

  it('turns confirmed words tentative again when the model changes its mind', () => {
    const live = applied(partial(0, 1, 'ahoj Peter pozrel'), partial(0, 2, 'ahoj Peter pozrel som'), partial(0, 3, 'ahoj Petra pozrel som si'));

    expect(live.view()).toEqual({ confirmed: 'ahoj', tentative: 'Petra pozrel som si' });
  });

  it('ignores a partial that is older than the one shown', () => {
    const live = applied(partial(0, 3, 'ahoj Peter pozrel'), partial(0, 2, 'ahoj'));

    expect(live.view()).toEqual({ confirmed: '', tentative: 'ahoj Peter pozrel' });
  });

  it('shows finals solid in segment order and drops the partials they replace', () => {
    const live = applied(partial(0, 1, 'ahoj Peter'), final(1, 'vyzerá to dobre'), final(0, 'ahoj Peter, pozrel som si ten pull request,'), partial(0, 5, 'neskoro'));

    expect(live.view()).toEqual({ confirmed: 'ahoj Peter, pozrel som si ten pull request, vyzerá to dobre', tentative: '' });
  });

  it('keeps the next segment tentative after the confirmed finals', () => {
    const live = applied(final(0, 'ahoj Peter.'), partial(1, 1, 'pozrel som'), partial(1, 2, 'pozrel som si ten'));

    expect(live.view()).toEqual({ confirmed: 'ahoj Peter. pozrel som', tentative: 'si ten' });
  });

  it('keeps the partial of a segment whose final is still pending', () => {
    const live = applied(final(0, 'jedna.'), partial(1, 1, 'dva tri'), partial(1, 2, 'dva tri'), partial(2, 1, 'štyri'));

    expect(live.view()).toEqual({ confirmed: 'jedna. dva tri', tentative: 'štyri' });
  });

  it('skips empty finals', () => {
    expect(applied(final(0, ''), final(1, 'ahoj')).view()).toEqual({ confirmed: 'ahoj', tentative: '' });
  });

  it('starts over on a restart', () => {
    const live = applied(final(0, 'stará verzia'), partial(1, 1, 'stará'), { type: 'restart' }, partial(0, 1, 'nová'));

    expect(live.view()).toEqual({ confirmed: '', tentative: 'nová' });
  });

  it('keeps only the end of a long transcript cut at a word boundary', () => {
    const words = Array.from({ length: 200 }, (_value, index) => `slovo${index}`);
    const live = applied(final(0, words.join(' ')), partial(1, 1, 'koniec vety'));

    const view = live.view();
    expect(view.tentative).toBe('koniec vety');
    expect(`${view.confirmed} ${view.tentative}`.length).toBeLessThanOrEqual(LIVE_TEXT_CHARS);
    expect(view.confirmed.endsWith('slovo199')).toBe(true);
    expect(words).toContain(view.confirmed.split(' ')[0]);
  });
});
