import { useRef, type KeyboardEvent } from 'react';
import type { RailBadges } from '../home/readiness';
import { PAGES, type PageDefinition, type PageId } from '../navigation';
import { Led } from './Led';
import { Logo } from './Logo';
import { PageIcon } from './PageIcon';
import { RailVersion } from './UpdateFooter';

const STEP_BY_KEY: Partial<Record<string, number>> = { ArrowDown: 1, ArrowUp: -1 };

const ATTENTION_ID = 'rail-attention';

type RailProps = { selected: PageId; badges: RailBadges; onSelect: (page: PageId) => void };

type RailTabProps = { page: PageDefinition; selected: boolean; badge: RailBadges[PageId]; register: (element: HTMLButtonElement | null) => void; onSelect: () => void };

export function tabId(page: PageId): string {
  return `tab-${page}`;
}

export function panelId(page: PageId): string {
  return `panel-${page}`;
}

function RailTab({ page, selected, badge, register, onSelect }: RailTabProps) {
  return (
    <button
      ref={register}
      type="button"
      role="tab"
      id={tabId(page.id)}
      aria-controls={panelId(page.id)}
      aria-selected={selected}
      aria-describedby={badge === undefined ? undefined : ATTENTION_ID}
      tabIndex={selected ? 0 : -1}
      onClick={onSelect}
    >
      <PageIcon page={page.id} />
      {page.label}
      {badge !== undefined && (
        <span className="badge">
          <Led state={badge} />
        </span>
      )}
    </button>
  );
}

export function Rail({ selected, badges, onSelect }: RailProps) {
  const tabs = useRef(new Map<PageId, HTMLButtonElement>());

  function moveFocus(event: KeyboardEvent<HTMLDivElement>) {
    const step = STEP_BY_KEY[event.key];
    if (step === undefined) {
      return;
    }
    event.preventDefault();
    const current = PAGES.findIndex((page) => page.id === selected);
    const next = PAGES[(current + step + PAGES.length) % PAGES.length];
    if (next === undefined) {
      return;
    }
    onSelect(next.id);
    tabs.current.get(next.id)?.focus();
  }

  function register(page: PageId): (element: HTMLButtonElement | null) => void {
    return (element) => {
      if (element === null) {
        tabs.current.delete(page);
        return;
      }
      tabs.current.set(page, element);
    };
  }

  return (
    <aside className="rail">
      <div className="rail-logo">
        <Logo />
      </div>
      <div className="nav" role="tablist" aria-orientation="vertical" aria-label="Sekcie aplikácie" onKeyDown={moveFocus}>
        {PAGES.map((page) => (
          <RailTab key={page.id} page={page} selected={page.id === selected} badge={badges[page.id]} register={register(page.id)} onSelect={() => onSelect(page.id)} />
        ))}
      </div>
      <span id={ATTENTION_ID} className="visually-hidden">
        Vyžaduje pozornosť
      </span>
      <RailVersion />
    </aside>
  );
}
