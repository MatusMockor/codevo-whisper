import type { TranscriptionSection } from '../../shared/section-focus';
import type { GlyphName } from '../components/glyph-name';
import { PAGE_GLYPHS } from '../components/page-glyphs';
import { PAGES, type NavTarget } from '../navigation';
import { matchesTerms } from '../search/text-match';
import type { SettingsGroupEntry, SettingsGroupId } from '../settings/settings-catalog';

export type PaletteEntry = { id: string; title: string; group: string; keywords: string; icon: GlyphName; target: NavTarget };

const GROUP_GLYPHS: Readonly<Record<SettingsGroupId, GlyphName>> = {
  dictation: 'key',
  microphone: 'mic',
  insertion: 'insert',
  transcript: 'wave',
  ai: 'spark',
  history: 'copy',
  system: 'sliders',
  access: 'lock',
};

type TranscriptionEntry = { section: TranscriptionSection; title: string; keywords: string; icon: GlyphName };

const TRANSCRIPTION_ENTRIES: readonly TranscriptionEntry[] = [
  { section: 'engine', title: 'Trasa prepisu', keywords: 'kde beží prepis poradie záloha hlavný', icon: 'route' },
  { section: 'server', title: 'Vlastný server', keywords: 'spárovať párovanie server pripojiť odpojiť odtlačok', icon: 'server' },
  { section: 'local-model', title: 'Lokálny model', keywords: 'model stiahnuť akcelerácia gpu cpu uvoľniť pamäť offline', icon: 'laptop' },
];

function pageEntries(): readonly PaletteEntry[] {
  return PAGES.map((page) => ({ id: `page-${page.id}`, title: page.label, group: 'Stránka', keywords: page.title, icon: PAGE_GLYPHS[page.id], target: { page: page.id } }));
}

function transcriptionEntries(): readonly PaletteEntry[] {
  return TRANSCRIPTION_ENTRIES.map((entry) => ({ id: `transcription-${entry.section}`, title: entry.title, group: 'Prepis', keywords: entry.keywords, icon: entry.icon, target: { page: 'transcription', section: entry.section } }));
}

function settingEntries(groups: readonly SettingsGroupEntry[]): readonly PaletteEntry[] {
  return groups.flatMap((group) =>
    group.rows.map((row) => ({ id: `setting-${row.id}`, title: row.title, group: group.title, keywords: row.keywords, icon: GROUP_GLYPHS[group.id], target: { page: 'settings', setting: row.id } })),
  );
}

export function paletteEntries(groups: readonly SettingsGroupEntry[]): readonly PaletteEntry[] {
  return [...pageEntries(), ...transcriptionEntries(), ...settingEntries(groups)];
}

export function filterEntries(entries: readonly PaletteEntry[], terms: readonly string[]): readonly PaletteEntry[] {
  return entries.filter((entry) => matchesTerms(`${entry.title} ${entry.group} ${entry.keywords}`, terms));
}
