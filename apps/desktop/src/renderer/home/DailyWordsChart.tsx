import { useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { ChartScale, DayStats, DayWords } from '../../shared/stats';
import { chartScale } from '../../shared/stats-chart';
import { dailyWords } from '../../shared/stats-summary';
import { cssVars } from '../components/css-vars';
import { SegmentedControl, type SegmentOption } from '../components/SegmentedControl';
import { chartDayLabel, compactNumber, formatNumber, weekdayDate } from './format';

type ChartRange = '7' | '30';

const RANGES: ReadonlyArray<SegmentOption<ChartRange>> = [
  { id: '7', label: '7 dní' },
  { id: '30', label: '30 dní' },
];

const STEP_BY_KEY: Partial<Record<string, number>> = { ArrowLeft: -1, ArrowRight: 1 };

type BarProps = { day: DayWords; top: number; today: string; showValue: boolean; active: boolean; register: (element: HTMLButtonElement | null) => void; onFocus: () => void };

function wordsText(words: number): string {
  if (words === 0) {
    return 'Bez diktovania';
  }
  return `${formatNumber(words)} slov`;
}

function Bar({ day, top, today, showValue, active, register, onFocus }: BarProps) {
  const isToday = day.date === today;
  const classes = ['wc-col', isToday ? 'today' : '', day.words === 0 ? 'zero' : ''].filter(Boolean).join(' ');
  return (
    <button ref={register} type="button" className={classes} style={cssVars({ '--v': (day.words / top).toFixed(3) })} tabIndex={active ? 0 : -1} aria-label={`${weekdayDate(day.date, today)}: ${formatNumber(day.words)} slov`} onFocus={onFocus}>
      <span className="wc-bar" />
      {isToday && showValue && (
        <span className="wc-val" aria-hidden="true">
          {formatNumber(day.words)}
        </span>
      )}
      <span className="wc-tip" aria-hidden="true">
        <b>{wordsText(day.words)}</b>
        <span>{isToday ? 'dnes' : weekdayDate(day.date, today)}</span>
      </span>
    </button>
  );
}

type PlotProps = { series: readonly DayWords[]; scale: ChartScale; today: string; dense: boolean };

function nextIndex(key: string, current: number, last: number): number | null {
  if (key === 'Home') {
    return 0;
  }
  if (key === 'End') {
    return last;
  }
  const step = STEP_BY_KEY[key];
  if (step === undefined) {
    return null;
  }
  return Math.min(last, Math.max(0, current + step));
}

function BarPlot({ series, scale, today, dense }: PlotProps) {
  const last = series.length - 1;
  const [focused, setFocused] = useState<number | null>(null);
  const bars = useRef(new Map<number, HTMLButtonElement>());
  const active = Math.min(focused ?? last, last);

  function move(event: KeyboardEvent<HTMLDivElement>): void {
    const next = nextIndex(event.key, active, last);
    if (next === null) {
      return;
    }
    event.preventDefault();
    setFocused(next);
    bars.current.get(next)?.focus();
  }

  function register(index: number): (element: HTMLButtonElement | null) => void {
    return (element) => {
      if (element === null) {
        bars.current.delete(index);
        return;
      }
      bars.current.set(index, element);
    };
  }

  const label = `Slová za posledných ${series.length} dní, spolu ${formatNumber(scale.total)}, priemer ${formatNumber(scale.average)} za deň. Šípkami vľavo a vpravo prejdete po dňoch.`;
  return (
    <div className="wc-plot" role="group" aria-label={label} onKeyDown={move}>
      {scale.ticks.slice(1).map((tick) => (
        <span key={tick} className="wc-grid" style={cssVars({ '--p': tick / scale.top })} />
      ))}
      <span className="wc-avg" style={cssVars({ '--p': scale.average / scale.top })} aria-hidden="true" />
      <div className="wc-cols">
        {series.map((day, index) => (
          <Bar key={day.date} day={day} top={scale.top} today={today} showValue={!dense} active={index === active} register={register(index)} onFocus={() => setFocused(index)} />
        ))}
      </div>
    </div>
  );
}

function YAxis({ scale }: { scale: ChartScale }) {
  return (
    <div className="wc-y" aria-hidden="true">
      {scale.ticks.map((tick) => (
        <span key={tick} style={cssVars({ '--p': tick / scale.top })}>
          {compactNumber(tick)}
        </span>
      ))}
    </div>
  );
}

function XAxis({ series, today, dense }: { series: readonly DayWords[]; today: string; dense: boolean }) {
  return (
    <div className="wc-x" aria-hidden="true">
      {series.map((day) => (
        <span key={day.date} className={day.date === today ? 'today' : undefined}>
          {chartDayLabel(day.date, today, dense)}
        </span>
      ))}
    </div>
  );
}

function Legend({ average }: { average: number }) {
  return (
    <span className="legend" aria-hidden="true">
      <span>
        <i className="amber" />
        dnes
      </span>
      <span>
        <i />
        ostatné dni
      </span>
      <span>
        <i className="avg" />
        priemer {formatNumber(average)}
      </span>
    </span>
  );
}

export function DailyWordsChart({ days, today }: { days: readonly DayStats[]; today: string }) {
  const [range, setRange] = useState<ChartRange>('7');
  const series = useMemo(() => dailyWords(days, today, Number(range)), [days, today, range]);
  const scale = chartScale(series.map((day) => day.words));
  const dense = range === '30';
  return (
    <div className="st-chart">
      <div className="chart-top">
        <span className="ttl">
          Slová za deň<span>{formatNumber(scale.total)} spolu</span>
        </span>
        <Legend average={scale.average} />
        <SegmentedControl label="Rozsah grafu" options={RANGES} value={range} onChange={setRange} />
      </div>
      <div className={dense ? 'wc dense' : 'wc'} style={cssVars({ '--n': series.length })}>
        <YAxis scale={scale} />
        <div className="wc-main">
          <BarPlot series={series} scale={scale} today={today} dense={dense} />
          <XAxis series={series} today={today} dense={dense} />
        </div>
      </div>
    </div>
  );
}
