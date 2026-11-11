import { useCallback, useEffect, useState } from 'react';
import { panelId, Rail, tabId } from './components/Rail';
import { StatusBar } from './components/StatusBar';
import { railBadges } from './home/readiness';
import { useDictation, type Dictation } from './home/use-dictation';
import { pageDefinition, pageFromHash, type NavTarget, type PageId } from './navigation';
import { Home } from './pages/Home';
import { Meetings } from './pages/Meetings';
import { Onboarding } from './pages/Onboarding';
import { Privacy } from './pages/Privacy';
import { Settings } from './pages/Settings';
import { Transcription } from './pages/Transcription';
import { useSectionFocusRequests } from './components/use-section-focus';
import { CommandPalette, type PaletteRequest } from './palette/CommandPalette';
import { paletteEntries } from './palette/palette-entries';
import { usePaletteShortcut } from './palette/use-palette-shortcut';
import { settingsGroups } from './settings/settings-catalog';
import { SETTINGS_PLATFORM } from './settings/settings-platform';
import { useSettings } from './settings/use-settings';

const INSET_TITLE_BAR = navigator.userAgent.includes('Mac');

const PALETTE_ENTRIES = paletteEntries(settingsGroups(SETTINGS_PLATFORM, SETTINGS_PLATFORM === 'linux'));

type PageContentProps = { target: NavTarget; dictation: Dictation; onNavigate: (target: NavTarget) => void; onOpenPalette: (query: string) => void };

function PageContent({ target, dictation, onNavigate, onOpenPalette }: PageContentProps) {
  if (target.page === 'home') {
    return <Home dictation={dictation} onNavigate={onNavigate} />;
  }
  if (target.page === 'meetings') {
    return <Meetings onNavigate={onNavigate} />;
  }
  if (target.page === 'settings') {
    return <Settings target={target} onNavigate={onNavigate} onOpenPalette={onOpenPalette} />;
  }
  if (target.page === 'transcription') {
    return <Transcription target={target} dictation={dictation} onNavigate={onNavigate} />;
  }
  return <Privacy onNavigate={onNavigate} />;
}

function PageHead({ page }: { page: PageId }) {
  const { label, title, lead } = pageDefinition(page);
  return (
    <div className="phead">
      <div>
        {title !== label && <p className="kick">{label}</p>}
        <h1>{title}</h1>
        {lead !== undefined && <p className="sub">{lead}</p>}
      </div>
      {page === 'home' && <span className="label-mono">Kliknite na uzol a upravte ho</span>}
    </div>
  );
}

function Shell() {
  const [target, setTarget] = useState<NavTarget>(() => ({ page: pageFromHash(window.location.hash) }));
  const dictation = useDictation();
  const badges = dictation.status.kind === 'ready' ? railBadges(dictation.status.value, dictation.issue) : {};

  const [palette, setPalette] = useState<PaletteRequest | null>(null);

  const navigate = useCallback((next: NavTarget) => setTarget({ ...next }), []);
  const openPalette = useCallback((query: string) => setPalette({ query }), []);
  const togglePalette = useCallback(() => setPalette((current) => (current === null ? { query: '' } : null)), []);

  useEffect(() => window.codevo.on('open-page', (page) => setTarget({ page })), []);
  useSectionFocusRequests(navigate);
  usePaletteShortcut(togglePalette);

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
            <PageContent target={target} dictation={dictation} onNavigate={navigate} onOpenPalette={openPalette} />
          </section>
        </main>
      </div>
      <StatusBar dictation={dictation} />
      <CommandPalette request={palette} entries={PALETTE_ENTRIES} onClose={() => setPalette(null)} onRun={(entry) => navigate(entry.target)} />
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
