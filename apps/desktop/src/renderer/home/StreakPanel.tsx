import { useMemo } from 'react';
import type { DayStats, HeatCell, StatsSummary } from '../../shared/stats';
import { activityWeeks } from '../../shared/stats-heatmap';
import { dayAndMonth, dayWord, formatNumber, weekdayDate } from './format';

const WEEKDAYS = ['po', 'ut', 'st', 'št', 'pi', 'so', 'ne'] as const;

const LEVELS = [0, 1, 2, 3, 4] as const;

function cellClass(cell: HeatCell): string {
  return ['c', `l${cell.level}`, cell.today ? 'today' : '', cell.future ? 'fut' : ''].filter(Boolean).join(' ');
}

function cellTip(cell: HeatCell, today: string): string | undefined {
  if (cell.future) {
    return undefined;
  }
  const words = cell.words === 0 ? 'bez diktovania' : `${formatNumber(cell.words)} slov`;
  return `${cell.today ? 'Dnes' : weekdayDate(cell.date, today)}: ${words}`;
}

function Heatmap({ weeks, today }: { weeks: HeatCell[][]; today: string }) {
  const past = weeks.flat().filter((cell) => !cell.future);
  const active = past.filter((cell) => cell.words > 0).length;
  const label = `Aktivita za posledných ${weeks.length - 1} týždňov a tento týždeň: diktovali ste ${active} z ${past.length} dní.`;
  return (
    <div className="hm" role="img" aria-label={label}>
      {WEEKDAYS.map((weekday, row) => [
        <span key={weekday} className="rl">
          {row % 2 === 0 ? weekday : ''}
        </span>,
        ...weeks.map((week, column) => {
          const cell = week[row];
          return cell === undefined ? null : <span key={`${column}-${row}`} className={cellClass(cell)} data-tip={cellTip(cell, today)} />;
        }),
      ])}
    </div>
  );
}

function since(summary: StatsSummary): string {
  if (summary.streakSince === null) {
    return 'Séria začne prvým diktovaním.';
  }
  return `Diktujete každý deň od ${dayAndMonth(summary.streakSince)}`;
}

export function StreakPanel({ days, today, summary }: { days: readonly DayStats[]; today: string; summary: StatsSummary }) {
  const weeks = useMemo(() => activityWeeks(days, today), [days, today]);
  return (
    <div className="st-streak" role="group" aria-labelledby="h-streak">
      <span className="st-label" id="h-streak">
        Séria
      </span>
      <p className="big">
        <span className="v">{formatNumber(summary.streakDays)}</span>
        <span className="unit">{dayWord(summary.streakDays)} po sebe</span>
      </p>
      <p className="sub">{since(summary)}</p>
      <Heatmap weeks={weeks} today={today} />
      <div className="hm-legend" aria-hidden="true">
        <span>menej</span>
        {LEVELS.map((level) => (
          <i key={level} className={`l${level}`} />
        ))}
        <span>viac</span>
      </div>
    </div>
  );
}
