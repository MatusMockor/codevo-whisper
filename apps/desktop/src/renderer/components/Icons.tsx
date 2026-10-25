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

export function LockIcon() {
  return (
    <Icon>
      <rect x="3" y="7" width="10" height="7.5" rx="2" />
      <path d="M5.2 7V5a2.8 2.8 0 0 1 5.6 0v2" />
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
