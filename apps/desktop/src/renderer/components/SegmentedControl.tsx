export type SegmentOption<T extends string> = { id: T; label: string; disabled?: boolean };

type SegmentedControlProps<T extends string> = {
  label: string;
  options: ReadonlyArray<SegmentOption<T>>;
  value: T;
  onChange: (value: T) => void;
};

export function SegmentedControl<T extends string>({ label, options, value, onChange }: SegmentedControlProps<T>) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          aria-pressed={option.id === value}
          disabled={option.disabled === true}
          onClick={() => {
            onChange(option.id);
          }}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
