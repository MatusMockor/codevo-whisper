import { useRef, type KeyboardEvent } from 'react';
import { PAGES, type PageId } from '../navigation';
import { Logo } from './Logo';
import { PageIcon } from './PageIcon';
import { UpdateIndicator } from './UpdateIndicator';

const STEP_BY_KEY: Partial<Record<string, number>> = { ArrowDown: 1, ArrowUp: -1 };

type SidebarProps = { selected: PageId; onSelect: (page: PageId) => void };

export function tabId(page: PageId): string {
  return `tab-${page}`;
}

export function panelId(page: PageId): string {
  return `panel-${page}`;
}

export function Sidebar({ selected, onSelect }: SidebarProps) {
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

  return (
    <aside className="side">
      <div className="brand">
        <Logo />
        Codevo Whisper
      </div>
      <div className="nav" role="tablist" aria-orientation="vertical" aria-label="Sekcie aplikácie" onKeyDown={moveFocus}>
        {PAGES.map((page) => (
          <button
            key={page.id}
            ref={(element) => {
              if (element === null) {
                tabs.current.delete(page.id);
                return;
              }
              tabs.current.set(page.id, element);
            }}
            type="button"
            role="tab"
            id={tabId(page.id)}
            aria-controls={panelId(page.id)}
            aria-selected={page.id === selected}
            tabIndex={page.id === selected ? 0 : -1}
            onClick={() => {
              onSelect(page.id);
            }}
          >
            <PageIcon page={page.id} />
            {page.label}
          </button>
        ))}
      </div>
      <UpdateIndicator />
    </aside>
  );
}
