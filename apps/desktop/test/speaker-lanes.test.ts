import { describe, expect, it } from 'vitest';
import { speakerTimeline, speakerTone } from '../src/renderer/meetings/speaker-lanes';
import type { Turn } from '../src/shared/meetings';

const turn = (speaker: string, t0Ms: number, t1Ms: number): Turn => ({ speaker, t0Ms, t1Ms, text: 'text' });

describe('speakerTone', () => {
  it('gives the recording person, every numbered speaker and the rest of the call their own tone', () => {
    expect(['Ja', 'Hovoriaci 1', 'Hovoriaci 2', 'Hovoriaci 3', 'Hovoriaci 4', 'Ostatní', 'Neznámy'].map(speakerTone)).toEqual([1, 2, 3, 4, 5, 0, 0]);
  });
});

describe('speakerTimeline', () => {
  it('lays every turn on its speaker lane as a share of the meeting length', () => {
    const timeline = speakerTimeline([turn('Ostatní', 0, 25_000), turn('Ja', 25_000, 50_000), turn('Ostatní', 50_000, 100_000)], 100_000);

    expect(timeline.lanes).toEqual([
      { speaker: 'Ja', tone: 1, spans: [{ start: 25, width: 25 }] },
      { speaker: 'Ostatní', tone: 0, spans: [{ start: 0, width: 25 }, { start: 50, width: 50 }] },
    ]);
    expect(timeline.marks).toEqual(['00:00', '00:25', '00:50', '01:15', '01:40']);
  });

  it('orders numbered speakers after the recording person and keeps the rest of the call last', () => {
    const timeline = speakerTimeline([turn('Hovoriaci 2', 0, 1_000), turn('Ostatní', 1_000, 2_000), turn('Hovoriaci 1', 2_000, 3_000), turn('Ja', 3_000, 4_000)], 4_000);

    expect(timeline.lanes.map((lane) => lane.speaker)).toEqual(['Ja', 'Hovoriaci 1', 'Hovoriaci 2', 'Ostatní']);
  });

  it('keeps very short turns visible and inside the track', () => {
    const [lane] = speakerTimeline([turn('Ja', 0, 10), turn('Ja', 999_990, 1_000_000)], 1_000_000).lanes;

    const [first, last] = lane?.spans ?? [];
    expect(first).toEqual({ start: 0, width: 0.4 });
    expect(last?.start).toBeCloseTo(99.999);
    expect((last?.start ?? 0) + (last?.width ?? 0)).toBeCloseTo(100);
  });

  it('stretches the axis when the transcript outlasts the stored duration', () => {
    expect(speakerTimeline([turn('Ja', 0, 8_000)], 4_000).marks.at(-1)).toBe('00:08');
  });

  it('draws nothing without speech', () => {
    expect(speakerTimeline([], 60_000)).toEqual({ lanes: [], marks: [] });
  });
});
