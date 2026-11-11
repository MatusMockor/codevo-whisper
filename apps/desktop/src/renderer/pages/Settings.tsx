import { useEffect, useMemo, useRef, useState } from 'react';
import type { Settings as SettingsValue } from '../../shared/settings';
import { MicrophonePicker } from '../components/MicrophonePicker';
import { revealSection } from '../components/use-reveal-section';
import type { NavTarget } from '../navigation';
import { InputPermissionsStep } from '../onboarding/InputPermissionsStep';
import { searchTerms } from '../search/text-match';
import { AiSection } from '../settings/AiSection';
import { DictationSection } from '../settings/DictationSection';
import { HistorySection } from '../settings/HistorySection';
import { InsertionSection } from '../settings/InsertionSection';
import { revealSetting } from '../settings/reveal-setting';
import { SaveErrorNotice } from '../settings/SaveErrorNotice';
import { filterSettings, settingsGroups } from '../settings/settings-catalog';
import { SETTINGS_PLATFORM } from '../settings/settings-platform';
import { SettingsSearchContext } from '../settings/settings-search';
import { SettingsBlock, SettingsGroup } from '../settings/SettingsGroup';
import { SettingsIndex } from '../settings/SettingsIndex';
import { SettingsToolbar } from '../settings/SettingsToolbar';
import { SystemSection } from '../settings/SystemSection';
import { TranscriptSection } from '../settings/TranscriptSection';
import { useActiveGroup } from '../settings/use-active-group';
import { useModels } from '../settings/use-models';
import { usePermissions } from '../settings/use-permissions';
import { saveSettings, useSettings } from '../settings/use-settings';

type SettingsProps = { target: NavTarget; onNavigate: (target: NavTarget) => void; onOpenPalette: (query: string) => void };

function useRevealTarget(target: NavTarget): void {
  useEffect(() => {
    if (target.setting !== undefined) {
      revealSetting(target.setting);
      return;
    }
    if (target.section !== undefined) {
      revealSection(target.section);
    }
  }, [target]);
}

function useTargetQuery(target: NavTarget): [string, (query: string) => void] {
  const [search, setSearch] = useState({ target, query: '' });
  return [search.target === target ? search.query : '', (query) => setSearch({ target, query })];
}

function NoHits({ onOpenPalette }: { onOpenPalette: () => void }) {
  return (
    <p className="set-nohits">
      Nič sa nenašlo. Skúste iné slovo alebo otvorte{' '}
      <button type="button" className="linkbtn" onClick={onOpenPalette}>
        príkazovú paletu
      </button>
      .
    </p>
  );
}

type SettingsLayoutProps = SettingsProps & { value: SettingsValue };

function SettingsLayout({ target, value, onNavigate, onOpenPalette }: SettingsLayoutProps) {
  const models = useModels();
  const permissions = usePermissions();
  const root = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useTargetQuery(target);
  const access = permissions.permissions.kind === 'ready' && permissions.permissions.value.platform === 'linux';
  const groups = useMemo(() => settingsGroups(SETTINGS_PLATFORM, access), [access]);
  const terms = useMemo(() => searchTerms(query), [query]);
  const filter = useMemo(() => filterSettings(groups, terms), [groups, terms]);
  const search = useMemo(() => ({ terms, filter, groups }), [terms, filter, groups]);
  const active = useActiveGroup(root, `${groups.length}:${terms.join(' ')}`);
  const activeModel = models.catalog.kind === 'ready' ? (models.catalog.value.models.find((model) => model.id === value.localModelId) ?? null) : null;
  useRevealTarget(target);

  return (
    <div className="page set-page" ref={root}>
      <div className="set-layout">
        <SettingsIndex groups={groups} filter={filter} active={active} onNavigate={onNavigate} />
        <div className="set-main">
          <SettingsToolbar query={query} results={filter === null ? null : filter.rows.size} onQuery={setQuery} onOpenPalette={() => onOpenPalette(query)} />
          <SaveErrorNotice />
          <SettingsSearchContext value={search}>
            <DictationSection settings={value} activeModel={activeModel} />
            <SettingsGroup group="microphone">
              <SettingsBlock id="microphone-input">
                <MicrophonePicker microphone={value.microphone} onChange={(microphone) => saveSettings({ microphone })} />
              </SettingsBlock>
            </SettingsGroup>
            <InsertionSection settings={value} />
            <TranscriptSection settings={value} />
            <AiSection settings={value} />
            <HistorySection />
            <SystemSection launchAtLogin={value.launchAtLogin} />
            {access && (
              <SettingsGroup group="access" tag="Linux">
                <SettingsBlock id="system-access">
                  <InputPermissionsStep permissions={permissions.permissions} refresh={permissions.refresh} />
                </SettingsBlock>
              </SettingsGroup>
            )}
          </SettingsSearchContext>
          {filter !== null && filter.rows.size === 0 && <NoHits onOpenPalette={() => onOpenPalette(query)} />}
        </div>
      </div>
    </div>
  );
}

export function Settings(props: SettingsProps) {
  const settings = useSettings();
  if (settings.kind === 'loading') {
    return null;
  }
  if (settings.kind === 'failed') {
    return (
      <p className="load-error" role="alert">
        Nastavenia sa nepodarilo načítať.
      </p>
    );
  }
  return <SettingsLayout {...props} value={settings.value} />;
}
