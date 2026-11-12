import type { DictationMode } from '../../shared/settings';

export const MODE_DESCRIPTIONS: Readonly<Record<DictationMode, string>> = Object.freeze({
  smart: 'Krátke stlačenie zapne diktovanie, ďalšie ho ukončí. Pri podržaní aspoň 300 ms sa diktovanie ukončí uvoľnením klávesu.',
  hold: 'Nahráva sa, kým kláves držíte.',
  toggle: 'Prvé stlačenie začne nahrávať, druhé ukončí.',
});
