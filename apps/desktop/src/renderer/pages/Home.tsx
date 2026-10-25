import { useMemo, useState } from 'react';
import type { StatsPeriod } from '../../shared/stats';
import { summarize } from '../../shared/stats-summary';
import { LastTranscriptCard } from '../components/LastTranscriptCard';
import { LockIcon } from '../components/Icons';
import { PeriodSwitch } from '../components/PeriodSwitch';
import { StatTiles } from '../components/StatTiles';
import { StatusBanner } from '../components/StatusBanner';
import { WordsChart } from '../components/WordsChart';
import { liveValueOr, useLiveValue } from '../home/live-value';
import { useLastTranscript } from '../home/use-last-transcript';
import { useToday } from '../home/use-today';

type HomeProps = { onOpenSettings: () => void };

const loadStatus = () => window.codevo.getStatus();

const loadStats = () => window.codevo.getStats();

export function Home({ onOpenSettings }: HomeProps) {
  const [period, setPeriod] = useState<StatsPeriod>('today');
  const status = useLiveValue('status-changed', loadStatus);
  const stats = useLiveValue('stats-changed', loadStats);
  const lastTranscript = useLastTranscript();
  const today = useToday();
  const days = liveValueOr(stats, []);
  const summary = useMemo(() => summarize(days, period, today), [days, period, today]);

  return (
    <div className="home">
      <StatusBanner status={status} onOpenSettings={onOpenSettings} />
      <div className="stats-head">
        <h2 id="h-stats">Štatistiky</h2>
        <PeriodSwitch value={period} onChange={setPeriod} />
      </div>
      {stats.kind === 'failed' && (
        <p className="load-error" role="alert">
          Štatistiky sa nepodarilo načítať.
        </p>
      )}
      <div className="stats" role="group" aria-labelledby="h-stats">
        <StatTiles summary={summary} />
        <WordsChart days={summary.last7} today={today} />
      </div>
      <p className="privline">
        <LockIcon />
        <span>Štatistiky sú len súčty čísel na tomto Macu, bez textu.</span>
      </p>
      <LastTranscriptCard transcript={lastTranscript} />
    </div>
  );
}
