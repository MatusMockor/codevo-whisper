import type { JSX } from 'react';

export type GlyphName =
  | 'home'
  | 'meet'
  | 'server'
  | 'sliders'
  | 'shield'
  | 'mic'
  | 'key'
  | 'wave'
  | 'spark'
  | 'insert'
  | 'route'
  | 'lock'
  | 'copy'
  | 'check'
  | 'trash'
  | 'refresh'
  | 'warn'
  | 'x';

const PATHS: Readonly<Record<GlyphName, () => JSX.Element>> = {
  home: () => <path d="M3.5 10.5 12 3.5l8.5 7V20a1 1 0 0 1-1 1H15v-6H9v6H4.5a1 1 0 0 1-1-1z" />,
  meet: () => (
    <>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6M16 5a3.2 3.2 0 0 1 0 6M17.5 14.3c2 .8 3.5 2.8 3.5 5.7" />
    </>
  ),
  server: () => (
    <>
      <rect x="3" y="4" width="18" height="7" rx="1.6" />
      <rect x="3" y="13" width="18" height="7" rx="1.6" />
      <path d="M7 7.5h.01M7 16.5h.01M11 7.5h6M11 16.5h6" />
    </>
  ),
  sliders: () => (
    <>
      <path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1" />
      <circle cx="15" cy="6" r="2" />
      <circle cx="9" cy="12" r="2" />
      <circle cx="17" cy="18" r="2" />
    </>
  ),
  shield: () => (
    <>
      <path d="M12 3l7.5 3v5.8c0 4.4-3.2 8.2-7.5 9.2-4.3-1-7.5-4.8-7.5-9.2V6z" />
      <path d="M9 12l2.2 2.2L15.5 10" />
    </>
  ),
  mic: () => (
    <>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7" />
    </>
  ),
  key: () => (
    <>
      <rect x="2.5" y="6" width="19" height="12" rx="2.2" />
      <path d="M6.5 10h.01M10 10h.01M14 10h.01M17.5 10h.01M7.5 14h9" />
    </>
  ),
  wave: () => <path d="M3 12h1.5M7 8.5v7M10.5 5v14M14 8v8M17.5 10.5v3M21 12h-.5" />,
  spark: () => (
    <>
      <path d="M12 3.5l1.9 5.1 5.1 1.9-5.1 1.9L12 17.5l-1.9-5.1L5 10.5l5.1-1.9z" />
      <path d="M18.5 16v4M16.5 18h4" />
    </>
  ),
  insert: () => <path d="M3.5 7h9M3.5 12h6M3.5 17h9M17.5 6.5v11M15.5 6.5h4M15.5 17.5h4" />,
  route: () => (
    <>
      <circle cx="5" cy="6" r="2.2" />
      <circle cx="19" cy="18" r="2.2" />
      <path d="M7.2 6h7.3a3 3 0 0 1 0 6h-5a3 3 0 0 0 0 6h7.3" />
    </>
  ),
  lock: () => (
    <>
      <rect x="5" y="10.5" width="14" height="10" rx="2" />
      <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
    </>
  ),
  copy: () => (
    <>
      <rect x="8.5" y="8.5" width="11.5" height="11.5" rx="2" />
      <path d="M15.5 8.5V5.5a1 1 0 0 0-1-1h-9a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h3" />
    </>
  ),
  check: () => <path d="M5 12.5l4.5 4.5L19 7.5" />,
  trash: () => <path d="M4.5 7h15M10 11v6M14 11v6M6.5 7l.9 12.2a1 1 0 0 0 1 .8h7.2a1 1 0 0 0 1-.8L17.5 7M9.5 7V4.5h5V7" />,
  refresh: () => <path d="M19.5 11.5a7.5 7.5 0 1 0-2.2 5.3M19.5 5v6.5H13" />,
  warn: () => (
    <>
      <path d="M12 4 2.8 19.5h18.4z" />
      <path d="M12 10v4.2M12 17h.01" />
    </>
  ),
  x: () => <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />,
};

type GlyphProps = { name: GlyphName; size?: 'sm' | 'md' | 'lg' };

export function Glyph({ name, size = 'md' }: GlyphProps) {
  const Paths = PATHS[name];
  return (
    <svg className={`ic ic-${size}`} viewBox="0 0 24 24" aria-hidden="true">
      <Paths />
    </svg>
  );
}
