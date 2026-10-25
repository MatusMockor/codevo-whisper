const ARC = 'M44 18 A26 26 0 0 1 66.5 57 L56.1 51 A14 14 0 0 0 44 30 Z';

export function Logo() {
  return (
    <svg viewBox="12 12 64 64" aria-hidden="true">
      <rect x="12" y="12" width="64" height="64" rx="15" fill="#0B1120" />
      <path d={ARC} fill="#22D3EE" />
      <path d={ARC} fill="#E2E8F0" transform="rotate(180 44 44)" />
      <circle cx="44" cy="44" r="3.2" fill="#22D3EE" />
    </svg>
  );
}
