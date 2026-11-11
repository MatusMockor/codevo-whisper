import type { ReactNode } from 'react';

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg className="ic" viewBox="0 0 16 16" aria-hidden="true">
      {children}
    </svg>
  );
}

export function CheckIcon() {
  return (
    <Icon>
      <path d="M3.5 8.5l3 3 6-7" />
    </Icon>
  );
}

export function CopyIcon() {
  return (
    <Icon>
      <rect x="5.5" y="5.5" width="8" height="8" rx="2" />
      <path d="M10.5 3.2V3a1.5 1.5 0 0 0-1.5-1.5H4A1.5 1.5 0 0 0 2.5 3v5A1.5 1.5 0 0 0 4 9.5h.3" />
    </Icon>
  );
}

export function WarnIcon() {
  return (
    <Icon>
      <path d="M8 4.5v4.2M8 11.3h.01" />
    </Icon>
  );
}

export function PauseIcon() {
  return (
    <Icon>
      <path d="M6 4.5v7M10 4.5v7" />
    </Icon>
  );
}

export function PlusIcon() {
  return (
    <Icon>
      <path d="M8 3v10M3 8h10" />
    </Icon>
  );
}

export function RefreshIcon() {
  return (
    <Icon>
      <path d="M13.5 8a5.5 5.5 0 1 1-5.5-5.5c1.54 0 3.02.61 4.12 1.68L13.5 5.5M13.5 2v3.5H10" />
    </Icon>
  );
}
