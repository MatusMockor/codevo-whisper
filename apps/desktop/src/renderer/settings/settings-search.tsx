import { createContext, useContext } from 'react';
import { Highlight } from '../search/Highlight';
import type { SettingId, SettingsFilter, SettingsGroupEntry, SettingsGroupId } from './settings-catalog';

export type SettingsSearch = { terms: readonly string[]; filter: SettingsFilter | null; groups: readonly SettingsGroupEntry[] };

const NO_SEARCH: SettingsSearch = Object.freeze({ terms: [], filter: null, groups: [] });

export const SettingsSearchContext = createContext<SettingsSearch>(NO_SEARCH);

export function useSettingsSearch(): SettingsSearch {
  return useContext(SettingsSearchContext);
}

export function useSettingVisible(id: SettingId | undefined): boolean {
  const { filter } = useSettingsSearch();
  return filter === null || id === undefined || filter.rows.has(id);
}

export function useGroupVisible(id: SettingsGroupId): boolean {
  const { filter } = useSettingsSearch();
  return filter === null || filter.groups.has(id);
}

export function SearchHighlight({ text }: { text: string }) {
  return <Highlight text={text} terms={useSettingsSearch().terms} />;
}
