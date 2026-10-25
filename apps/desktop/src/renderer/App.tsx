import { useEffect, useState } from 'react';
import { panelId, Sidebar, tabId } from './components/Sidebar';
import { pageFromHash, PAGES, type PageId } from './navigation';
import { Home } from './pages/Home';
import { Onboarding } from './pages/Onboarding';
import { Privacy } from './pages/Privacy';
import { Server } from './pages/Server';
import { Settings } from './pages/Settings';
import { useSettings } from './settings/use-settings';

function pageLabel(page: PageId): string {
  return PAGES.find((definition) => definition.id === page)?.label ?? '';
}

function PageContent({ page, onSelect }: { page: PageId; onSelect: (page: PageId) => void }) {
  if (page === 'home') {
    return <Home onOpenSettings={() => onSelect('settings')} />;
  }
  if (page === 'settings') {
    return <Settings />;
  }
  if (page === 'server') {
    return <Server />;
  }
  return <Privacy onOpenSettings={() => onSelect('settings')} />;
}

function Shell() {
  const [selected, setSelected] = useState<PageId>(() => pageFromHash(window.location.hash));

  useEffect(() => window.codevo.on('open-page', setSelected), []);

  return (
    <div className="shell">
      <Sidebar selected={selected} onSelect={setSelected} />
      <main className="main">
        <header className="bar">
          <h1>{pageLabel(selected)}</h1>
        </header>
        <section className="panel" role="tabpanel" id={panelId(selected)} aria-labelledby={tabId(selected)}>
          <PageContent page={selected} onSelect={setSelected} />
        </section>
      </main>
    </div>
  );
}

export function App() {
  const settings = useSettings();
  if (settings.kind === 'loading') {
    return null;
  }
  if (settings.kind === 'ready' && !settings.value.onboardingDone) {
    return <Onboarding settings={settings.value} />;
  }
  return <Shell />;
}
