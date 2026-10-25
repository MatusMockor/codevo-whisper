type SwitchProps = { label: string; checked: boolean; onChange: (checked: boolean) => void };

export function Switch({ label, checked, onChange }: SwitchProps) {
  return (
    <button
      type="button"
      className="switch"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => {
        onChange(!checked);
      }}
    />
  );
}
