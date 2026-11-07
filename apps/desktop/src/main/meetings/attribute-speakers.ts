import type { MeetingTrack, SpeakerSegment, Turn, Word } from '../../shared/meetings';

export type TrackWords = { track: MeetingTrack; startOffsetMs: number; words: Word[]; segments?: SpeakerSegment[] };

type SpokenWord = Word & { speaker: string };

const TURN_GAP_MS = 2000;

const TRACK_SPEAKERS: Record<MeetingTrack, string> = { mic: 'Ja', system: 'Ostatní' };

function spoken({ track, startOffsetMs, words }: TrackWords): SpokenWord[] {
  return words.map((word) => ({ speaker: TRACK_SPEAKERS[track], t0Ms: word.t0Ms + startOffsetMs, t1Ms: word.t1Ms + startOffsetMs, text: word.text }));
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
