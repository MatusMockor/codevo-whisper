import { levelBars } from '../settings/level-bars';

const BAR_COUNT = 24;

const HOT_FROM = 19;

export function LevelMeter({ level }: { level: number }) {
  const lit = levelBars(level, BAR_COUNT);
  return (
    <div className="meter" role="meter" aria-label="Úroveň mikrofónu" aria-valuemin={0} aria-valuemax={BAR_COUNT} aria-valuenow={lit}>
      {Array.from({ length: BAR_COUNT }, (_unused, index) => (
        <i key={index} className={[index < lit ? 'on' : '', index >= HOT_FROM ? 'hot' : ''].join(' ').trim() || undefined} />
      ))}
    </div>
  );
}
