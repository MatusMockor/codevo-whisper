import { useMemo, useState } from 'react';
import { localDate } from '../../shared/calendar-date';
import type { StatsPeriod } from '../../shared/stats';
import { summarize } from '../../shared/stats-summary';
import { LastTranscriptCard } from '../components/LastTranscriptCard';
import { LockIcon } from '../components/Icons';
import { PeriodSwitch } from '../components/PeriodSwitch';
import { StatTiles } from '../components/StatTiles';
import { StatusBanner } from '../components/StatusBanner';
import { WordsChart } from '../components/WordsChart';
import { useLastTranscript, useLiveValue } from '../home/live-value';

type HomeProps = { onOpenSettings: () => void };

const loadStatus = () => window.codevo.getStatus();

const loadStats = () => window.codevo.getStats();

export function Home({ onOpenSettings }: HomeProps) {
  const [period, setPeriod] = useState<StatsPeriod>('today');
  const status = useLiveValue('status-changed', loadStatus);
  const days = useLiveValue('stats-changed', loadStats);
  const lastTranscript = useLastTranscript();
  const today = localDate(new Date());
  const summary = useMemo(() => summarize(days ?? [], period, today), [days, period, today]);

  return (
    <div className="home">
      <StatusBanner status={status} onOpenSettings={onOpenSettings} />
      <div className="stats-head">
        <h2 id="h-stats">Štatistiky</h2>
        <PeriodSwitch value={period} onChange={setPeriod} />
      </div>
      <div className="stats" role="group" aria-labelledby="h-stats">
        <StatTiles summary={summary} />
        <WordsChart days={summary.last7} today={today} />
      </div>
      <p className="privline">
        <LockIcon />
        <span>Štatistiky sú len súčty čísel na tomto Macu, bez textu.</span>
      </p>
      <LastTranscriptCard text={lastTranscript} />
    </div>
  );
}
