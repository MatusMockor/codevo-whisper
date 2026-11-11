import { formatClock, type Turn } from '../../shared/meetings';

export type SpeakerTone = 0 | 1 | 2 | 3 | 4 | 5;

export type LaneSpan = { start: number; width: number };

export type SpeakerLane = { speaker: string; tone: SpeakerTone; spans: LaneSpan[] };

export type SpeakerTimeline = { lanes: SpeakerLane[]; marks: string[] };

const OWN_SPEAKER = 'Ja';
const NUMBERED_SPEAKER = /^Hovoriaci ([1-4])$/;
const MIN_SPAN_PERCENT = 0.4;
const MARK_FRACTIONS: readonly number[] = Object.freeze([0, 0.25, 0.5, 0.75, 1]);

export function speakerTone(speaker: string): SpeakerTone {
  if (speaker === OWN_SPEAKER) {
    return 1;
  }
  const numbered = NUMBERED_SPEAKER.exec(speaker);
  if (numbered === null) {
    return 0;
  }
  return (Number(numbered[1]) + 1) as SpeakerTone;
}

function laneOrder(tone: SpeakerTone): number {
  return tone === 0 ? Number.MAX_SAFE_INTEGER : tone;
}

function span(turn: Turn, totalMs: number): LaneSpan {
  const start = (turn.t0Ms / totalMs) * 100;
  const width = Math.max(((turn.t1Ms - turn.t0Ms) / totalMs) * 100, MIN_SPAN_PERCENT);
  return { start, width: Math.min(width, 100 - start) };
}

export function speakerTimeline(turns: readonly Turn[], durationMs: number): SpeakerTimeline {
  const totalMs = Math.max(durationMs, ...turns.map((turn) => turn.t1Ms));
  if (turns.length === 0 || totalMs <= 0) {
    return { lanes: [], marks: [] };
  }
  const speakers = [...new Set(turns.map((turn) => turn.speaker))].sort((a, b) => laneOrder(speakerTone(a)) - laneOrder(speakerTone(b)));
  const lanes = speakers.map((speaker) => ({
    speaker,
    tone: speakerTone(speaker),
    spans: turns.filter((turn) => turn.speaker === speaker).map((turn) => span(turn, totalMs)),
  }));
  return { lanes, marks: MARK_FRACTIONS.map((fraction) => formatClock(totalMs * fraction)) };
}
