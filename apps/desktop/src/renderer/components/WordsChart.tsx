import type { DayWords } from '../../shared/stats';
import { formatNumber, longDayName, shortDayName } from '../home/format';

const WIDTH = 268;
const BASE = 122;
const TOP = 22;
const BAR_WIDTH = 22;
const MIN_BAR = 4;

type BarProps = { day: DayWords; index: number; slot: number; max: number; today: string };

function barHeight(words: number, max: number): number {
  if (words === 0) {
    return 0;
  }
  return Math.max(MIN_BAR, ((BASE - TOP) * words) / max);
}

function Bar({ day, index, slot, max, today }: BarProps) {
  const now = day.date === today;
  const height = barHeight(day.words, max);
  const center = slot * index + slot / 2;
  return (
    <g className={now ? 'bar now' : 'bar'}>
      <title>{`${longDayName(day.date, today)}: ${formatNumber(day.words)} slov`}</title>
      <rect className="hit" x={center - slot / 2} y={0} width={slot} height={BASE + 22} />
      <rect className="col" x={center - BAR_WIDTH / 2} y={BASE - height} width={BAR_WIDTH} height={height + 4} rx={4} />
      <text className="val" x={center} y={BASE - height - 6} textAnchor="middle">
        {formatNumber(day.words)}
      </text>
      <text className={now ? 'day now' : 'day'} x={center} y={BASE + 20} textAnchor="middle">
        {shortDayName(day.date)}
      </text>
    </g>
  );
}

type WordsChartProps = { days: readonly DayWords[]; today: string };

export function WordsChart({ days, today }: WordsChartProps) {
  const slot = WIDTH / Math.max(1, days.length);
  const max = Math.max(1, ...days.map((day) => day.words));
  const total = days.reduce((sum, day) => sum + day.words, 0);
  const description = days.map((day) => `${longDayName(day.date, today)} ${formatNumber(day.words)} slov`).join(', ');
  return (
    <div className="week">
      <div className="week-top">
        <b id="h-week">Slová za posledných 7 dní</b>
        <span>spolu {formatNumber(total)}</span>
      </div>
      <svg viewBox="0 0 268 150" role="img" aria-labelledby="h-week week-desc">
        <desc id="week-desc">{description}</desc>
        {days.map((day, index) => (
          <Bar key={day.date} day={day} index={index} slot={slot} max={max} today={today} />
        ))}
        <g>
          <rect className="mask" x={0} y={BASE + 1} width={WIDTH} height={4} />
          <line className="base" x1={0} x2={WIDTH} y1={BASE + 0.5} y2={BASE + 0.5} />
        </g>
      </svg>
    </div>
  );
}
