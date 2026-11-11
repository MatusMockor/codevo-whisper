import type { GlyphName } from '../components/Glyph';
import type { ZoneId } from './privacy-zones';

export type ZoneFact = { icon: GlyphName; text: string };

export type ZoneCopy = { id: ZoneId; icon: GlyphName; title: string; scope: string; facts: readonly ZoneFact[] };

export type StoredItem = { what: string; where: string };

export const ZONES: readonly ZoneCopy[] = Object.freeze([
  {
    id: 'local',
    icon: 'laptop',
    title: 'Ostáva na tomto počítači',
    scope: 'Vždy',
    facts: [
      { icon: 'check', text: 'Zvuk pri lokálnom prepise. Nahrávka existuje iba počas prepisu.' },
      { icon: 'check', text: 'Nastavenia, štatistiky a voliteľná história prepisov.' },
      { icon: 'check', text: 'Nahrávky, prepisy a poznámky zo stretnutí.' },
    ],
  },
  {
    id: 'server',
    icon: 'server',
    title: 'Ide na váš server',
    scope: 'Iba ak je server v trase prepisu',
    facts: [
      { icon: 'lock', text: 'Zvuk diktátu, zašifrovaný už na tomto počítači.' },
      { icon: 'lock', text: 'Prepis sa vracia šifrovane. Server zvuk ani text zámerne neukladá.' },
      { icon: 'check', text: 'História prepisov ostáva iba na tomto zariadení.' },
    ],
  },
  {
    id: 'ai',
    icon: 'spark',
    title: 'Ide k AI poskytovateľovi',
    scope: 'Iba ak nastavíte AI úpravu',
    facts: [
      { icon: 'check', text: 'Iba hotový text, nikdy zvuk.' },
      { icon: 'check', text: 'Pri AI serveri na adrese 127.0.0.1 alebo localhost text neopustí počítač.' },
      { icon: 'warn', text: 'Codex CLI posiela text do OpenAI pod vaším účtom.' },
    ],
  },
]);

export const VOICE_STEPS: readonly string[] = Object.freeze([
  'Mikrofón sa zapne, až keď podržíte kláves. Keď ho pustíte, vypne sa.',
  'Zvuk sa prepíše na text priamo na tomto počítači stiahnutým modelom.',
  'Nahrávka existuje iba počas prepisu a hneď potom sa zahodí.',
  'Text sa vloží do aplikácie. Posledné diktovanie ostane iba v pamäti, kým aplikáciu nezatvoríte.',
]);

export const NEVER: readonly string[] = Object.freeze([
  'V lokálnom režime neposiela zvuk na internet a text iba AI poskytovateľovi, ktorého si nastavíte.',
  'Nezbiera analytiku ani telemetriu.',
  'Neuchováva zvuk v histórii prepisov.',
  'Nepotrebuje účet, e-mail ani predplatné.',
]);

export const STORED: readonly StoredItem[] = Object.freeze([
  { what: 'Nastavenia', where: 'settings.json' },
  { what: 'Súhrnné štatistiky po dňoch, bez textu', where: 'stats.json' },
  { what: 'Voliteľná história prepisov, nešifrovaný text', where: 'history.json' },
  { what: 'Nahrávky, prepisy a poznámky zo stretnutí', where: 'meetings/' },
  { what: 'Stiahnuté modely na prepis a rozpoznávanie hovoriacich', where: 'models/' },
  { what: 'Párovanie so serverom, šifrované systémovým úložiskom', where: 'server-pairing.json' },
  { what: 'API kľúč AI servera, šifrovaný systémovým úložiskom', where: 'ai-key.json' },
  { what: 'Verzia aplikácie, pre ktorú je model pripravený na rýchly štart', where: 'warm-up.json' },
]);

export const HISTORY_RULES: readonly string[] = Object.freeze([
  'Predvolene je vypnutá. Po zapnutí ukladá iba text budúcich úspešne dokončených prepisov, nikdy zvuk.',
  'Limit je 10, 50, 100 alebo 500 prepisov, predvolene 100. Najstaršie sa vymažú automaticky, nižší limit ich vymaže ihneď.',
  'Na stránke Domov vymažete jeden prepis alebo celú históriu. Vypnutie v Nastaveniach históriu vymaže a zastaví ukladanie.',
  'Vymazanie nemení súhrnné štatistiky, posledné diktovanie v pamäti ani schránku. Nejde o bezpečné prepísanie disku.',
]);

export const METER_NOTE = 'Ukazovateľ úrovne v Nastaveniach používa mikrofón iba vtedy, keď máte Nastavenia otvorené a okno aplikácie je aktívne.';
