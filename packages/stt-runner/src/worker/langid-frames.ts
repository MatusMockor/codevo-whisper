import { assertLanguageSet, type LanguageCode, type LanguageScore } from '../languages';
import { parseProbability, parseRankedScores, type ScoreRow } from '../ranked-scores';
import { boundedAudio } from './worker-frames';

export const LANGUAGE_ID_FRAME = 0xfe;
export const MAX_LANGUAGE_ID_REPLY_BYTES = 2048;

const REPLY_LINE = /^([a-z]{2,3}) (\S+)$/;

function codeEntry(code: LanguageCode): Buffer {
  const bytes = Buffer.from(code, 'ascii');
  return Buffer.concat([Buffer.from([bytes.length]), bytes]);
}

function replyRow(line: string): ScoreRow | undefined {
  const match = REPLY_LINE.exec(line);
  if (match === null) {
    return undefined;
  }
  return { code: match[1] ?? '', p: parseProbability(match[2] ?? '') };
}

export function encodeLanguageIdRequest(allowed: readonly LanguageCode[], pcm: Uint8Array): Uint8Array {
  assertLanguageSet(allowed);
  const { samples, audio } = boundedAudio(pcm);
  const count = Buffer.alloc(4);
  count.writeUInt32LE(samples);
  return Buffer.concat([Buffer.from([LANGUAGE_ID_FRAME, allowed.length]), ...allowed.map(codeEntry), count, audio]);
}

export function parseLanguageIdReply(text: string, allowed: readonly LanguageCode[]): LanguageScore[] {
  return parseRankedScores(text, allowed, replyRow, 'language id worker');
}
