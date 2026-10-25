import type { StatsPeriod } from '../../shared/stats';

const PERIODS: ReadonlyArray<{ id: StatsPeriod; label: string }> = [
  { id: 'today', label: 'Dnes' },
  { id: 'week', label: 'Tento týždeň' },
  { id: 'total', label: 'Celkom' },
];

type PeriodSwitchProps = { value: StatsPeriod; onChange: (period: StatsPeriod) => void };

export function PeriodSwitch({ value, onChange }: PeriodSwitchProps) {
  return (
    <div className="seg" role="group" aria-label="Obdobie štatistík">
      {PERIODS.map((period) => (
        <button
          key={period.id}
          type="button"
          aria-pressed={period.id === value}
          onClick={() => {
            onChange(period.id);
          }}
        >
          {period.label}
        </button>
      ))}
    </div>
  );
}
