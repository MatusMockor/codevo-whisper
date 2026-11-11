import { matchesTerms } from '../search/text-match';

export type SettingsGroupId = 'dictation' | 'microphone' | 'insertion' | 'transcript' | 'ai' | 'history' | 'system' | 'access';

export type SettingId =
  | 'hotkey'
  | 'mode'
  | 'overlay'
  | 'language'
  | 'mute'
  | 'feedback'
  | 'feedback-output'
  | 'feedback-volume'
  | 'microphone-input'
  | 'insertion-method'
  | 'linux-paste'
  | 'clipboard'
  | 'auto-submit'
  | 'custom-words'
  | 'filler-words'
  | 'trailing-space'
  | 'ai-provider'
  | 'ai-connection'
  | 'ai-polish'
  | 'history-enabled'
  | 'history-limit'
  | 'launch-at-login'
  | 'stats'
  | 'updates'
  | 'system-access';

export type SettingsPlatform = 'mac' | 'linux';

export type SettingEntry = { id: SettingId; title: string; keywords: string; linuxOnly?: true };

type GroupDefinition = { id: SettingsGroupId; title: string; rows: readonly SettingEntry[]; linuxOnly?: true };

export type SettingsGroupEntry = GroupDefinition & { index: string };

export type SettingsFilter = { rows: ReadonlySet<SettingId>; groups: ReadonlySet<SettingsGroupId> };

const GROUPS: readonly GroupDefinition[] = [
  {
    id: 'dictation',
    title: 'Diktovanie',
    rows: [
      { id: 'hotkey', title: 'Klávesová skratka', keywords: 'hotkey kláves skratka nahrať' },
      { id: 'mode', title: 'Režim', keywords: 'režim klávesu inteligentný podrž prepínanie' },
      { id: 'overlay', title: 'Zobrazenie panela', keywords: 'panel overlay indikátor živý text' },
      { id: 'language', title: 'Jazyk', keywords: 'jazyk slovenčina čeština angličtina automaticky' },
      { id: 'mute', title: 'Stlmiť počas nahrávania', keywords: 'stlmiť zvuk hudba výstup' },
      { id: 'feedback', title: 'Zvuková odozva', keywords: 'zvuk odozva pípnutie' },
      { id: 'feedback-output', title: 'Výstupné zariadenie', keywords: 'reproduktory slúchadlá výstup zvuková odozva' },
      { id: 'feedback-volume', title: 'Hlasitosť', keywords: 'hlasitosť zvuková odozva' },
    ],
  },
  {
    id: 'microphone',
    title: 'Mikrofón',
    rows: [{ id: 'microphone-input', title: 'Vstup', keywords: 'mikrofón vstup úroveň bluetooth airpods zariadenie' }],
  },
  {
    id: 'insertion',
    title: 'Vkladanie textu',
    rows: [
      { id: 'insertion-method', title: 'Spôsob vkladania', keywords: 'vložiť priame písanie skopírovať schránka' },
      { id: 'linux-paste', title: 'Skratka na vloženie', keywords: 'linux wayland x11 ctrl shift insert vloženie', linuxOnly: true },
      { id: 'clipboard', title: 'Schránka', keywords: 'schránka obnoviť nechať prepis' },
      { id: 'auto-submit', title: 'Automatické odoslanie', keywords: 'enter odoslať odoslanie cmd ctrl' },
    ],
  },
  {
    id: 'transcript',
    title: 'Úprava prepisu',
    rows: [
      { id: 'custom-words', title: 'Vlastné slová', keywords: 'slovník mená odborné výrazy pravopis' },
      { id: 'filler-words', title: 'Odstrániť výplňové slová', keywords: 'zaváhania ehm eee hmm' },
      { id: 'trailing-space', title: 'Pridať medzeru na konci', keywords: 'medzera koniec písanie' },
    ],
  },
  {
    id: 'ai',
    title: 'AI úprava textu',
    rows: [
      { id: 'ai-provider', title: 'Poskytovateľ', keywords: 'ai poskytovateľ vlastný server codex cli chatgpt openai' },
      { id: 'ai-connection', title: 'Pripojenie k modelu', keywords: 'ai adresa servera url model api kľúč ollama lm studio codex úroveň uvažovania overiť' },
      { id: 'ai-polish', title: 'Upraviť diktát cez AI', keywords: 'ai úprava interpunkcia zaváhania' },
    ],
  },
  {
    id: 'history',
    title: 'História prepisov',
    rows: [
      { id: 'history-enabled', title: 'Ukladať históriu prepisov', keywords: 'história ukladať prepisy' },
      { id: 'history-limit', title: 'Počet uchovaných prepisov', keywords: 'história limit počet' },
    ],
  },
  {
    id: 'system',
    title: 'Systém',
    rows: [
      { id: 'launch-at-login', title: 'Spustiť po prihlásení', keywords: 'spustenie prihlásenie štart lišta' },
      { id: 'stats', title: 'Štatistiky', keywords: 'štatistiky vynulovať vymazať' },
      { id: 'updates', title: 'Aktualizácie', keywords: 'aktualizácie verzia stiahnuť' },
    ],
  },
  {
    id: 'access',
    title: 'Prístup k systému',
    linuxOnly: true,
    rows: [{ id: 'system-access', title: 'Prístup ku klávesnici a textovým poliam', keywords: 'linux wayland x11 klávesnica prístupnosť rozpoznávanie textových polí povolenia' }],
  },
];

function forPlatform<T extends { linuxOnly?: true }>(platform: SettingsPlatform): (entry: T) => boolean {
  return (entry) => platform === 'linux' || entry.linuxOnly !== true;
}

export function settingsGroups(platform: SettingsPlatform, withAccess: boolean): readonly SettingsGroupEntry[] {
  return GROUPS.filter(forPlatform(platform))
    .filter((group) => withAccess || group.id !== 'access')
    .map((group, position) => ({ ...group, rows: group.rows.filter(forPlatform(platform)), index: String(position + 1).padStart(2, '0') }));
}

export function settingGroup(id: SettingId): SettingsGroupId | null {
  return GROUPS.find((group) => group.rows.some((row) => row.id === id))?.id ?? null;
}

function groupMatches(group: SettingsGroupEntry, terms: readonly string[]): readonly SettingEntry[] {
  if (matchesTerms(group.title, terms)) {
    return group.rows;
  }
  return group.rows.filter((row) => matchesTerms(`${row.title} ${row.keywords} ${group.title}`, terms));
}

export function filterSettings(groups: readonly SettingsGroupEntry[], terms: readonly string[]): SettingsFilter | null {
  if (terms.length === 0) {
    return null;
  }
  const rows = new Set<SettingId>();
  const visibleGroups = new Set<SettingsGroupId>();
  for (const group of groups) {
    const hits = groupMatches(group, terms);
    hits.forEach((row) => rows.add(row.id));
    if (hits.length > 0) {
      visibleGroups.add(group.id);
    }
  }
  return { rows, groups: visibleGroups };
}
