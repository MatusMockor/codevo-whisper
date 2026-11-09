import { useEffect, useState } from 'react';
import { panelId, Rail, tabId } from './components/Rail';
import { StatusBar } from './components/StatusBar';
import { railBadges } from './home/readiness';
import { useDictation, type Dictation } from './home/use-dictation';
import { pageDefinition, pageFromHash, type NavTarget, type PageId } from './navigation';
import { Home } from './pages/Home';
import { Meetings } from './pages/Meetings';
import { Onboarding } from './pages/Onboarding';
import { Privacy } from './pages/Privacy';
import { Server } from './pages/Server';
import { Settings } from './pages/Settings';
import { useSettingsFocusRequests } from './settings/use-settings-focus';
import { useSettings } from './settings/use-settings';

const INSET_TITLE_BAR = navigator.userAgent.includes('Mac');

type PageContentProps = { target: NavTarget; dictation: Dictation; onNavigate: (target: NavTarget) => void };

function PageContent({ target, dictation, onNavigate }: PageContentProps) {
  const openSettings = () => onNavigate({ page: 'settings' });
  if (target.page === 'home') {
    return <Home dictation={dictation} onNavigate={onNavigate} />;
  }
  if (target.page === 'meetings') {
    return <Meetings onOpenSettings={openSettings} />;
  }
  if (target.page === 'settings') {
    return <Settings target={target} onNavigate={onNavigate} />;
  }
  if (target.page === 'server') {
    return <Server />;
  }
  return <Privacy onOpenSettings={openSettings} />;
}

function PageHead({ page }: { page: PageId }) {
  const { label, title } = pageDefinition(page);
  return (
    <div className="phead">
      <div>
        {title !== label && <p className="kick">{label}</p>}
        <h1>{title}</h1>
      </div>
      {page === 'home' && <span className="label-mono">Kliknite na uzol a upravte ho</span>}
    </div>
  );
}

function Shell() {
  const [target, setTarget] = useState<NavTarget>(() => ({ page: pageFromHash(window.location.hash) }));
  const dictation = useDictation();
  const badges = dictation.status.kind === 'ready' ? railBadges(dictation.status.value, dictation.issue) : {};

  useEffect(() => window.codevo.on('open-page', (page) => setTarget({ page })), []);
  useSettingsFocusRequests(setTarget);

  return (
    <div className="shell">
      {INSET_TITLE_BAR && (
        <header className="tbar">
          <span className="ttl">Codevo Whisper</span>
        </header>
      )}
      <div className="body">
        <Rail selected={target.page} badges={badges} onSelect={(page) => setTarget({ page })} />
        <main className="main">
          <section key={target.page} className="panel" role="tabpanel" id={panelId(target.page)} aria-labelledby={tabId(target.page)}>
            <PageHead page={target.page} />
            <PageContent target={target} dictation={dictation} onNavigate={setTarget} />
          </section>
        </main>
      </div>
      <StatusBar dictation={dictation} />
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
