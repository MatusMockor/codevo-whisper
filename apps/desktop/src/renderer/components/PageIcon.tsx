import type { JSX } from 'react';
import type { PageId } from '../navigation';

function HomeIcon() {
  return <path d="M2.5 7.2L8 2.5l5.5 4.7V13a1 1 0 0 1-1 1h-3v-4h-3v4h-3a1 1 0 0 1-1-1z" />;
}

function ServerIcon() {
  return (
    <>
      <rect x="2" y="2.5" width="12" height="4.5" rx="1.5" />
      <rect x="2" y="9" width="12" height="4.5" rx="1.5" />
      <path d="M4.8 4.75h.01M4.8 11.25h.01M8 4.75h3M8 11.25h3" />
    </>
  );
}

function SlidersIcon() {
  return (
    <>
      <path d="M2.5 4.5h6M12 4.5h1.5M2.5 11.5H4M7.5 11.5h6" />
      <circle cx="10.2" cy="4.5" r="1.7" />
      <circle cx="5.8" cy="11.5" r="1.7" />
    </>
  );
}

function ShieldIcon() {
  return (
    <>
      <path d="M8 1.8l5 1.9v4c0 3.2-2.1 5.6-5 6.6-2.9-1-5-3.4-5-6.6v-4z" />
      <path d="M5.8 8l1.6 1.6 3-3.2" />
    </>
  );
}

const ICONS: Record<PageId, () => JSX.Element> = {
  home: HomeIcon,
  server: ServerIcon,
  settings: SlidersIcon,
  privacy: ShieldIcon,
};

export function PageIcon({ page }: { page: PageId }) {
  const Icon = ICONS[page];
  return (
    <svg className="ic" viewBox="0 0 16 16" aria-hidden="true">
      <Icon />
    </svg>
  );
}
