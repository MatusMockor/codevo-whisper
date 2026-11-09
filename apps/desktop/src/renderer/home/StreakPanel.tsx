import { useMemo } from 'react';
import type { DayStats, HeatCell, StatsSummary } from '../../shared/stats';
import { activityWeeks } from '../../shared/stats-heatmap';
import { useRovingFocus, type RovingFocus } from '../components/use-roving-focus';
import { dayAndMonth, dayWord, formatNumber, weekdayDate } from './format';

const WEEKDAYS = ['po', 'ut', 'st', 'št', 'pi', 'so', 'ne'] as const;

const LEVELS = [0, 1, 2, 3, 4] as const;

const DAYS_IN_WEEK = WEEKDAYS.length;

const STEP_BY_KEY = Object.freeze({ ArrowUp: -1, ArrowDown: 1, ArrowLeft: -DAYS_IN_WEEK, ArrowRight: DAYS_IN_WEEK });

function cellClass(cell: HeatCell): string {
  return ['c', `l${cell.level}`, cell.today ? 'today' : '', cell.future ? 'fut' : ''].filter(Boolean).join(' ');
}

function cellTip(cell: HeatCell, today: string): string {
  const words = cell.words === 0 ? 'bez diktovania' : `${formatNumber(cell.words)} slov`;
  return `${cell.today ? 'Dnes' : weekdayDate(cell.date, today)}: ${words}`;
}

type CellProps = { cell: HeatCell; index: number; today: string; roving: RovingFocus };

function Cell({ cell, index, today, roving }: CellProps) {
  if (cell.future) {
    return <span className={cellClass(cell)} aria-hidden="true" />;
  }
  const tip = cellTip(cell, today);
  return <button {...roving.item(index)} type="button" className={cellClass(cell)} data-tip={tip} aria-label={tip} />;
}

function Heatmap({ weeks, today }: { weeks: HeatCell[][]; today: string }) {
  const past = weeks.flat().filter((cell) => !cell.future);
  const active = past.filter((cell) => cell.words > 0).length;
  const roving = useRovingFocus(past.length, STEP_BY_KEY);
  const label = `Aktivita za posledných ${weeks.length - 1} týždňov a tento týždeň: diktovali ste ${active} z ${past.length} dní. Šípkami hore a dole prejdete po dňoch, vľavo a vpravo po týždňoch.`;
  return (
    <div className="hm" role="group" aria-label={label} onKeyDown={roving.onKeyDown}>
      {WEEKDAYS.map((weekday, row) => [
        <span key={weekday} className="rl" aria-hidden="true">
          {row % 2 === 0 ? weekday : ''}
        </span>,
        ...weeks.map((week, column) => {
          const cell = week[row];
          return cell === undefined ? null : <Cell key={cell.date} cell={cell} index={column * DAYS_IN_WEEK + row} today={today} roving={roving} />;
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
