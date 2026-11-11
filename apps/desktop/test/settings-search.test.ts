import { describe, expect, it } from 'vitest';
import { ActivityGate } from '../src/renderer/components/activity-gate';
import { filterEntries, paletteEntries } from '../src/renderer/palette/palette-entries';
import { isPaletteShortcut, paletteShortcutLabel, togglesPalette, type ShortcutEvent, type ShortcutKeys } from '../src/renderer/palette/palette-shortcut';
import { highlightParts, matchesTerms, searchTerms } from '../src/renderer/search/text-match';
import { pickActiveGroup } from '../src/renderer/settings/active-group';
import { filterSettings, settingGroup, settingsGroups } from '../src/renderer/settings/settings-catalog';

const MAC_GROUPS = settingsGroups('mac', false);
const LINUX_GROUPS = settingsGroups('linux', true);

function keys(overrides: Partial<ShortcutKeys>): ShortcutKeys {
  return { key: 'k', metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...overrides };
}

describe('settings text search', () => {
  it('ignores case and diacritics and needs every word of the query', () => {
    expect(searchTerms('  Schránka   AI ')).toEqual(['schranka', 'ai']);
    expect(matchesTerms('Výstupné zariadenie', searchTerms('vystupne'))).toBe(true);
    expect(matchesTerms('Výstupné zariadenie', searchTerms('ZARIADENIE výst'))).toBe(true);
    expect(matchesTerms('Výstupné zariadenie', searchTerms('zariadenie hlas'))).toBe(false);
  });

  it('marks every match in the original text, keeping diacritics', () => {
    expect(highlightParts('Stlmiť počas nahrávania', searchTerms('pocas'))).toEqual([
      { text: 'Stlmiť ', hit: false },
      { text: 'počas', hit: true },
      { text: ' nahrávania', hit: false },
    ]);
    expect(highlightParts('AI úprava textu', searchTerms('a'))).toEqual([
      { text: 'A', hit: true },
      { text: 'I úpr', hit: false },
      { text: 'a', hit: true },
      { text: 'v', hit: false },
      { text: 'a', hit: true },
      { text: ' textu', hit: false },
    ]);
    expect(highlightParts('Úprava prepisu', searchTerms('uprava'))).toEqual([
      { text: 'Úprava', hit: true },
      { text: ' prepisu', hit: false },
    ]);
    expect(highlightParts('Jazyk', [])).toEqual([{ text: 'Jazyk', hit: false }]);
  });
});

describe('settings catalog', () => {
  it('numbers the groups per platform and keeps Linux-only entries off the Mac', () => {
    expect(MAC_GROUPS.map((group) => [group.index, group.title])).toEqual([
      ['01', 'Diktovanie'],
      ['02', 'Mikrofón'],
      ['03', 'Vkladanie textu'],
      ['04', 'Úprava prepisu'],
      ['05', 'AI úprava textu'],
      ['06', 'História prepisov'],
      ['07', 'Systém'],
    ]);
    expect(MAC_GROUPS.flatMap((group) => group.rows.map((row) => row.id))).not.toContain('linux-paste');
    expect(LINUX_GROUPS.at(-1)).toMatchObject({ id: 'access', index: '08', title: 'Prístup k systému' });
    expect(LINUX_GROUPS.find((group) => group.id === 'insertion')?.rows.map((row) => row.id)).toContain('linux-paste');
    expect(settingsGroups('linux', false).map((group) => group.id)).not.toContain('access');
  });

  it('shows nothing filtered for an empty query', () => {
    expect(filterSettings(MAC_GROUPS, searchTerms('   '), 'server')).toBeNull();
  });

  it('finds rows by title, keyword or group and hides the groups without a hit', () => {
    const clipboard = filterSettings(MAC_GROUPS, searchTerms('schranka'), 'server');
    expect([...(clipboard?.rows ?? [])]).toEqual(['insertion-method', 'clipboard']);
    expect([...(clipboard?.groups ?? [])]).toEqual(['insertion']);

    const ollama = filterSettings(MAC_GROUPS, searchTerms('ollama'), 'server');
    expect([...(ollama?.rows ?? [])]).toEqual(['ai-provider', 'ai-connection']);

    const history = filterSettings(MAC_GROUPS, searchTerms('história prepisov'), 'server');
    expect([...(history?.rows ?? [])]).toEqual(['history-enabled', 'history-limit']);

    const none = filterSettings(MAC_GROUPS, searchTerms('wayland'), 'server');
    expect(none?.rows.size).toBe(0);
    expect(none?.groups.size).toBe(0);
    expect([...(filterSettings(LINUX_GROUPS, searchTerms('wayland'), 'server')?.groups ?? [])]).toEqual(['insertion', 'access']);
  });

  it('matches the connection fields of the active AI provider and keeps the provider switch in reach', () => {
    const rows = (query: string, provider: 'server' | 'codex') => [...(filterSettings(MAC_GROUPS, searchTerms(query), provider)?.rows ?? [])];

    expect(rows('API kľúč', 'server')).toEqual(['ai-provider', 'ai-connection']);
    expect(rows('API kľúč', 'codex')).toEqual(['ai-provider']);
    expect(rows('úroveň uvažovania', 'codex')).toEqual(['ai-provider', 'ai-connection']);
    expect(rows('úroveň uvažovania', 'server')).toEqual(['ai-provider']);
    expect(rows('overit', 'codex')).toEqual(['ai-provider', 'ai-connection']);
    expect(rows('interpunkcia', 'codex')).toEqual(['ai-polish']);
  });

  it('knows the group of every setting', () => {
    expect(settingGroup('feedback-volume')).toBe('dictation');
    expect(settingGroup('updates')).toBe('system');
    expect(settingGroup('system-access')).toBe('access');
  });
});

describe('settings index', () => {
  const positions = [
    { id: 'dictation', top: 120 },
    { id: 'microphone', top: 640 },
    { id: 'insertion', top: 900 },
  ] as const;

  it('highlights the last group that crossed the reading line', () => {
    expect(pickActiveGroup(positions, 100, false)).toBe('dictation');
    expect(pickActiveGroup(positions, 700, false)).toBe('microphone');
    expect(pickActiveGroup(positions, 2000, false)).toBe('insertion');
  });

  it('highlights the last group at the end of the page and nothing without groups', () => {
    expect(pickActiveGroup(positions, 100, true)).toBe('insertion');
    expect(pickActiveGroup([], 100, false)).toBeNull();
  });
});

describe('command palette', () => {
  const entries = paletteEntries(MAC_GROUPS);

  it('lists the pages, the Prepis sections and every setting row', () => {
    expect(entries.slice(0, 5).map((entry) => entry.title)).toEqual(['Domov', 'Stretnutia', 'Prepis', 'Nastavenia', 'Súkromie']);
    expect(entries.filter((entry) => entry.group === 'Prepis').map((entry) => entry.target)).toEqual([
      { page: 'transcription', section: 'engine' },
      { page: 'transcription', section: 'server' },
      { page: 'transcription', section: 'local-model' },
    ]);
    expect(entries.filter((entry) => entry.target.setting !== undefined)).toHaveLength(MAC_GROUPS.flatMap((group) => group.rows).length);
    expect(entries.find((entry) => entry.title === 'Hlasitosť')).toMatchObject({ group: 'Diktovanie', target: { page: 'settings', setting: 'feedback-volume' } });
  });

  it('filters entries by title, group and keywords', () => {
    expect(filterEntries(entries, searchTerms('sparovat')).map((entry) => entry.title)).toEqual(['Vlastný server']);
    expect(filterEntries(entries, searchTerms('gpu')).map((entry) => entry.title)).toEqual(['Lokálny model']);
    expect(filterEntries(entries, searchTerms('system spustit')).map((entry) => entry.title)).toEqual(['Spustiť po prihlásení']);
    expect(filterEntries(entries, searchTerms('api kluc')).map((entry) => entry.title)).toEqual(['Pripojenie k modelu']);
    expect(filterEntries(entries, searchTerms('uroven uvazovania')).map((entry) => entry.title)).toEqual(['Pripojenie k modelu']);
    expect(filterEntries(entries, [])).toHaveLength(entries.length);
  });

  it('opens with Cmd+K on the Mac and Ctrl+K elsewhere', () => {
    expect(isPaletteShortcut(keys({ metaKey: true }), true)).toBe(true);
    expect(isPaletteShortcut(keys({ ctrlKey: true }), true)).toBe(false);
    expect(isPaletteShortcut(keys({ ctrlKey: true, key: 'K' }), false)).toBe(true);
    expect(isPaletteShortcut(keys({ metaKey: true }), false)).toBe(false);
    expect(isPaletteShortcut(keys({ ctrlKey: true, shiftKey: true }), false)).toBe(false);
    expect(isPaletteShortcut(keys({ ctrlKey: true, key: 'j' }), false)).toBe(false);
    expect([paletteShortcutLabel(true), paletteShortcutLabel(false)]).toEqual(['⌘K', 'Ctrl+K']);
  });

  it('leaves the shortcut alone while a hotkey is recorded, while composing, on repeat or when already handled', () => {
    const event = (overrides: Partial<ShortcutEvent>): ShortcutEvent => ({ ...keys({ metaKey: true }), repeat: false, defaultPrevented: false, isComposing: false, ...overrides });

    expect(togglesPalette(event({}), true, false)).toBe(true);
    expect(togglesPalette(event({}), true, true)).toBe(false);
    expect(togglesPalette(event({ defaultPrevented: true }), true, false)).toBe(false);
    expect(togglesPalette(event({ repeat: true }), true, false)).toBe(false);
    expect(togglesPalette(event({ isComposing: true }), true, false)).toBe(false);
    expect(togglesPalette(event({ key: 'j' }), true, false)).toBe(false);
  });

  it('counts a hotkey recording as active until every recording ends', () => {
    const recording = new ActivityGate();
    expect(recording.active).toBe(false);

    const first = recording.begin();
    const second = recording.begin();
    first();
    first();
    expect(recording.active).toBe(true);
    second();

    expect(recording.active).toBe(false);
  });
});
