import type { LanguageSelection } from './language-selection';
import { SUPPORTED_LANGUAGES, type LanguageScore, type SupportedLanguage } from './languages';

function probabilityOf(rows: readonly LanguageScore[], code: SupportedLanguage): number {
  const p = rows.find((row) => row.code === code)?.p ?? 0;
  return Number.isFinite(p) && p > 0 ? p : 0;
}

function renormalised(rows: readonly LanguageScore[], order: readonly SupportedLanguage[]): LanguageScore[] {
  const raw = order.map((code) => ({ code, p: probabilityOf(rows, code) }));
  const mass = raw.reduce((sum, row) => sum + row.p, 0);
  if (mass === 0) {
    return raw.map((row) => ({ code: row.code, p: 1 / raw.length }));
  }
  return raw.map((row) => ({ code: row.code, p: row.p / mass }));
}

export class LanguageScores {
  private constructor(readonly rows: readonly LanguageScore[]) {}

  static from(rows: readonly LanguageScore[]): LanguageScores {
    return new LanguageScores(renormalised(rows, SUPPORTED_LANGUAGES));
  }

  restrictedTo(selection: LanguageSelection): LanguageScores {
    return new LanguageScores(renormalised(this.rows, selection.codes));
  }

  top(): LanguageScore {
    return this.rows.reduce((best, row) => (row.p > best.p ? row : best));
  }

  foreignWinner(selection: LanguageSelection, threshold: number): LanguageScore | null {
    const winner = this.top();
    if (selection.has(winner.code) || winner.p < threshold) {
      return null;
    }
    return winner;
  }
}
