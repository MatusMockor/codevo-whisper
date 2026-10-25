import type { ReactNode } from 'react';
import type { StatsSummary } from '../../shared/stats';
import { TYPING_WORDS_PER_MINUTE } from '../../shared/stats-summary';
import { dayAndMonth, dayWord, formatDuration, formatNumber } from '../home/format';

type TileProps = { label: string; value: ReactNode; hint: string };

function Tile({ label, value, hint }: TileProps) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>
        <span className="v">{value}</span>
        <span className="h">{hint}</span>
      </dd>
    </div>
  );
}

function wordsHint(summary: StatsSummary): string {
  if (summary.dictations === 0) {
    return 'zatiaľ nič';
  }
  return `priemerne ${formatNumber(Math.round(summary.words / summary.dictations))} slov naraz`;
}

function dictationsHint(summary: StatsSummary): string {
  if (summary.dictations === 0) {
    return 'zatiaľ nič';
  }
  return `jedno trvá v priemere ${Math.round(summary.seconds / summary.dictations)} s`;
}

function streakHint(summary: StatsSummary): string {
  if (summary.streakSince === null) {
    return 'začne prvým diktovaním';
  }
  return `každý deň od ${dayAndMonth(summary.streakSince)}`;
}

export function StatTiles({ summary }: { summary: StatsSummary }) {
  return (
    <dl className="tiles" aria-live="polite">
      <Tile label="Nadiktované slová" value={formatNumber(summary.words)} hint={wordsHint(summary)} />
      <Tile label="Počet diktovaní" value={formatNumber(summary.dictations)} hint={dictationsHint(summary)} />
      <Tile label="Čas diktovania" value={formatDuration(summary.seconds)} hint="čistý čas nahrávania" />
      <Tile
        label="Priemerná rýchlosť"
        value={
          <>
            {formatNumber(summary.wordsPerMinute)}
            <small>slov/min</small>
          </>
        }
        hint="počítané z času nahrávania"
      />
      <Tile label="Ušetrený čas" value={formatDuration(summary.savedSeconds)} hint={`odhad pri písaní ${TYPING_WORDS_PER_MINUTE} slov/min`} />
      <Tile
        label="Séria"
        value={
          <>
            {formatNumber(summary.streakDays)}
            <small>{dayWord(summary.streakDays)} po sebe</small>
          </>
        }
        hint={streakHint(summary)}
      />
    </dl>
  );
}
