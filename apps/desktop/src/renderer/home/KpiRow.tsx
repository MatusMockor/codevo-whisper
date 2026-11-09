import type { StatsSummary } from '../../shared/stats';
import { formatDuration, formatNumber } from './format';

type KpiProps = { label: string; value: string; note?: string | null; hot?: boolean };

function Kpi({ label, value, note = null, hot = false }: KpiProps) {
  return (
    <div className={hot ? 'hot' : undefined}>
      <dt>{label}</dt>
      <dd>
        <span className="v">{value}</span>
        {note !== null && <small>{note}</small>}
      </dd>
    </div>
  );
}

function perDictation(summary: StatsSummary, value: string): string | null {
  if (summary.dictations === 0) {
    return null;
  }
  return `Ø ${value}`;
}

export function KpiRow({ summary }: { summary: StatsSummary }) {
  return (
    <dl className="kpis" aria-live="polite">
      <Kpi label="Nadiktované slová" value={formatNumber(summary.words)} />
      <Kpi label="Počet diktovaní" value={formatNumber(summary.dictations)} note={perDictation(summary, `${formatNumber(summary.wordsPerDictation)} slov`)} />
      <Kpi label="Čas diktovania" value={formatDuration(summary.seconds)} note={perDictation(summary, `${formatNumber(summary.secondsPerDictation)} s`)} />
      <Kpi label="Priemerná rýchlosť" value={formatNumber(summary.wordsPerMinute)} note="slov/min" />
      <Kpi label="Ušetrený čas" value={formatDuration(summary.savedSeconds)} hot />
    </dl>
  );
}
