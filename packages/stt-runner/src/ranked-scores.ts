import type { LanguageCode, LanguageScore } from './languages';
import { TranscribeCliError } from './transcribe-cli-error';

export type ScoreRow = { code: string; p: number };

const MASS_TOLERANCE = 1e-3;

export type ScoreLineParser = (line: string, index: number) => ScoreRow | undefined;

function isProbability(p: number): boolean {
  return Number.isFinite(p) && p >= 0 && p <= 1;
}

function isRanked(rows: readonly ScoreRow[]): boolean {
  return rows.every((row, index) => index === 0 || row.p <= (rows[index - 1]?.p ?? 1));
}

function isDistribution(rows: readonly ScoreRow[]): boolean {
  const mass = rows.reduce((sum, row) => sum + row.p, 0);
  return Math.abs(mass - 1) <= MASS_TOLERANCE;
}

function isScoreSet(rows: readonly (ScoreRow | undefined)[], allowed: readonly LanguageCode[]): rows is ScoreRow[] {
  const defined = rows.filter((row) => row !== undefined);
  if (defined.length !== rows.length || rows.length !== allowed.length) {
    return false;
  }
  const permitted: ReadonlySet<string> = new Set(allowed);
  const codes = new Set(defined.map((row) => row.code));
  return codes.size === defined.length && defined.every((row) => permitted.has(row.code) && isProbability(row.p)) && isRanked(defined) && isDistribution(defined);
}

export function parseProbability(token: string): number {
  return /^[0-9.eE+-]+$/.test(token) ? Number(token) : Number.NaN;
}

export function parseRankedScores(text: string, allowed: readonly LanguageCode[], parseLine: ScoreLineParser, source: string): LanguageScore[] {
  const rows = text.trim().split('\n').map(parseLine);
  if (!isScoreSet(rows, allowed)) {
    throw new TranscribeCliError('exit', `${source} sent invalid language scores`);
  }
  return rows.map((row) => ({ code: row.code as LanguageCode, p: row.p }));
}
