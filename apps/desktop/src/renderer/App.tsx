import { useEffect, useState } from 'react';
import { panelId, Sidebar, tabId } from './components/Sidebar';
import { pageFromHash, PAGES, type PageId } from './navigation';

function pageLabel(page: PageId): string {
  return PAGES.find((definition) => definition.id === page)?.label ?? '';
}

export function App() {
  const [selected, setSelected] = useState<PageId>(() => pageFromHash(window.location.hash));

  useEffect(() => window.codevo.on('open-page', setSelected), []);

  return (
    <div className="shell">
      <Sidebar selected={selected} onSelect={setSelected} />
      <main className="main">
        <header className="bar">
          <h1>{pageLabel(selected)}</h1>
        </header>
        <section className="panel" role="tabpanel" id={panelId(selected)} aria-labelledby={tabId(selected)} />
      </main>
    </div>
  );
}
