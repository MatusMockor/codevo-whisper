import { useMemo, useState } from 'react';
import type { StatsPeriod } from '../../shared/stats';
import { summarize, TYPING_WORDS_PER_MINUTE } from '../../shared/stats-summary';
import { Glyph } from '../components/Glyph';
import { PeriodSwitch } from '../components/PeriodSwitch';
import { DailyWordsChart } from './DailyWordsChart';
import { KpiRow } from './KpiRow';
import { liveValueOr, useLiveValue } from './live-value';
import { StreakPanel } from './StreakPanel';
import { useToday } from './use-today';

const loadStats = () => window.codevo.getStats();

export function StatsCard() {
  const [period, setPeriod] = useState<StatsPeriod>('today');
  const stats = useLiveValue('stats-changed', loadStats);
  const today = useToday();
  const days = liveValueOr(stats, []);
  const summary = useMemo(() => summarize(days, period, today), [days, period, today]);

  return (
    <section className="st-card" role="group" aria-labelledby="h-stats">
      <div className="st-head">
        <h2 id="h-stats">Štatistiky</h2>
        <PeriodSwitch value={period} onChange={setPeriod} />
      </div>
      {stats.kind === 'failed' && (
        <p className="load-error" role="alert">
          Štatistiky sa nepodarilo načítať.
        </p>
      )}
      <KpiRow summary={summary} />
      <div className="st-body">
        <DailyWordsChart days={days} today={today} />
        <StreakPanel days={days} today={today} summary={summary} />
      </div>
      <div className="st-foot">
        <p className="privline">
          <Glyph name="lock" size="sm" />
          <span>Štatistiky sú len súčty čísel na tomto Macu, bez textu.</span>
        </p>
        <p className="st-note">Ušetrený čas je odhad oproti písaniu {TYPING_WORDS_PER_MINUTE} slov za minútu.</p>
      </div>
    </section>
  );
}
