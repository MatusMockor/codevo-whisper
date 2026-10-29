import { useLiveValue } from '../home/live-value';

const load = () => window.codevo.getHistory();
export const HISTORY_UNAVAILABLE = 'História nie je dostupná. Nepodarilo sa načítať súbor alebo odstrániť jeho dočasnú kópiu.';
export const HISTORY_SAVE_ERROR = 'Zmenu histórie sa nepodarilo uložiť alebo odstrániť dočasnú kópiu. Zobrazený je posledný uložený stav.';
export const HISTORY_MEMORY_NOTE = 'Posledné diktovanie ostáva v pamäti do zatvorenia aplikácie. Vymazanie histórie nemení štatistiky ani schránku.';

export function useHistory() {
  return useLiveValue('history-changed', load);
}
