import type { LanguageCode, LanguageScore } from './languages';
import { parseProbability, parseRankedScores, type ScoreRow } from './ranked-scores';

export const MAX_LANGUAGE_ID_CLI_OUTPUT_BYTES = 8192;

const CANDIDATE_LINE = /^candidate: (\d+) ([a-z]{2,3}) index=\d+ p=(\S+) logit=\S+$/;

function candidateRow(line: string, index: number): ScoreRow | undefined {
  const match = CANDIDATE_LINE.exec(line);
  if (match === null || Number(match[1]) !== index + 1) {
    return undefined;
  }
  return { code: match[2] ?? '', p: parseProbability(match[3] ?? '') };
}

export function parseLanguageIdCliOutput(text: string, allowed: readonly LanguageCode[]): LanguageScore[] {
  return parseRankedScores(text, allowed, candidateRow, 'transcribe-cli');
}
