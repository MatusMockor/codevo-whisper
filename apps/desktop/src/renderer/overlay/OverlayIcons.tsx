const ARC = 'M44 18 A26 26 0 0 1 66.5 57 L56.1 51 A14 14 0 0 0 44 30 Z';

export function MicIcon() {
  return (
    <svg className="ic" viewBox="0 0 16 16" aria-hidden="true">
      <rect x="5.5" y="1.5" width="5" height="8.5" rx="2.5" />
      <path d="M3 8a5 5 0 0 0 10 0M8 13v1.8" />
    </svg>
  );
}

export function LockIcon() {
  return (
    <svg className="ic" viewBox="0 0 16 16" aria-hidden="true">
      <rect x="3" y="7" width="10" height="7.5" rx="2" />
      <path d="M5.2 7V5a2.8 2.8 0 0 1 5.6 0v2" />
    </svg>
  );
}

export function CheckIcon() {
  return (
    <svg className="ic" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3.5 8.5l3 3 6-7" />
    </svg>
  );
}

export function CopyIcon() {
  return (
    <svg className="ic" viewBox="0 0 16 16" aria-hidden="true">
      <rect x="5.5" y="5.5" width="8" height="8" rx="2" />
      <path d="M10.5 3.2V3a1.5 1.5 0 0 0-1.5-1.5H4A1.5 1.5 0 0 0 2.5 3v5A1.5 1.5 0 0 0 4 9.5h.3" />
    </svg>
  );
}

export function WarnIcon() {
  return (
    <svg className="ic" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M8 4.5v4.2M8 11.3h.01" />
    </svg>
  );
}

export function MarkColor() {
  return (
    <svg viewBox="17 17 54 54" aria-hidden="true">
      <path d={ARC} fill="#22D3EE" />
      <path d={ARC} fill="#E2E8F0" transform="rotate(180 44 44)" />
      <circle cx="44" cy="44" r="3.2" fill="#22D3EE" />
    </svg>
  );
}
