import type { Ref } from 'react';

type SwitchProps = { label: string; checked: boolean; disabled?: boolean; ref?: Ref<HTMLButtonElement>; onChange: (checked: boolean) => void };

export function Switch({ label, checked, disabled, ref, onChange }: SwitchProps) {
  return (
    <button
      ref={ref}
      type="button"
      className="switch"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => {
        onChange(!checked);
      }}
    />
  );
}
