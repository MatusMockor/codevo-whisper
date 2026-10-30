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

export function XIcon() {
  return (
    <Icon>
      <path d="M4 4l8 8M12 4l-8 8" />
    </Icon>
  );
}

export function MicIcon() {
  return (
    <Icon>
      <rect x="5.5" y="1.5" width="5" height="8.5" rx="2.5" />
      <path d="M3 8a5 5 0 0 0 10 0M8 13v1.8" />
    </Icon>
  );
}

export function LaptopIcon() {
  return (
    <Icon>
      <rect x="3" y="3" width="10" height="7" rx="1" />
      <path d="M1.5 12.5h13" />
    </Icon>
  );
}

export function ServerIcon() {
  return (
    <Icon>
      <rect x="2" y="2.5" width="12" height="4.5" rx="1.5" />
      <rect x="2" y="9" width="12" height="4.5" rx="1.5" />
      <path d="M4.8 4.75h.01M4.8 11.25h.01M8 4.75h3M8 11.25h3" />
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
