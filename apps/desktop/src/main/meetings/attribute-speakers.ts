import type { MeetingTrack, SpeakerSegment, Turn, Word } from '../../shared/meetings';

export type TrackWords = { track: MeetingTrack; startOffsetMs: number; words: Word[]; segments?: SpeakerSegment[] };

type SpokenWord = Word & { speaker: string };

const TURN_GAP_MS = 2000;
const NEAREST_SEGMENT_MS = 1000;

const TRACK_SPEAKERS: Record<MeetingTrack, string> = { mic: 'Ja', system: 'Ostatní' };

function speakerAt(segments: readonly SpeakerSegment[], word: Word): number | null {
  const midpoint = (word.t0Ms + word.t1Ms) / 2;
  let nearest: number | null = null;
  let nearestDistance = NEAREST_SEGMENT_MS;
  for (const segment of segments) {
    const distance = Math.max(segment.t0Ms - midpoint, midpoint - segment.t1Ms, 0);
    if (distance === 0) return segment.speaker;
    if (distance <= nearestDistance) {
      nearest = segment.speaker;
      nearestDistance = distance;
    }
  }
  return nearest;
}

function speakerLabels(speakers: readonly (number | null)[]): Map<number | null, string> {
  const order = [...new Set(speakers.filter((speaker) => speaker !== null))];
  return new Map(order.length < 2 ? [] : order.map((speaker, index) => [speaker, `Hovoriaci ${index + 1}`] as const));
}

function spoken({ track, startOffsetMs, words, segments = [] }: TrackWords): SpokenWord[] {
  const ordered = [...words].sort((a, b) => a.t0Ms - b.t0Ms);
  const speakers = ordered.map((word) => speakerAt(segments, word));
  const labels = speakerLabels(speakers);
  return ordered.map((word, index) => ({
    speaker: labels.get(speakers[index] ?? null) ?? TRACK_SPEAKERS[track],
    t0Ms: word.t0Ms + startOffsetMs,
    t1Ms: word.t1Ms + startOffsetMs,
    text: word.text,
  }));
}

export function attributeSpeakers(tracks: readonly TrackWords[]): Turn[] {
  const words = tracks.flatMap(spoken).sort((a, b) => a.t0Ms - b.t0Ms);
  const turns: Turn[] = [];
  for (const word of words) {
    const last = turns.at(-1);
    if (last !== undefined && last.speaker === word.speaker && word.t0Ms - last.t1Ms < TURN_GAP_MS) {
      last.t1Ms = Math.max(last.t1Ms, word.t1Ms);
      last.text = `${last.text} ${word.text}`;
      continue;
    }
    turns.push({ speaker: word.speaker, t0Ms: word.t0Ms, t1Ms: word.t1Ms, text: word.text });
  }
  return turns;
}
