import type { LanguagePackView } from '../../shared/models';
import { useLiveValue, type Live } from '../home/live-value';

const loadLanguagePack = () => window.codevo.getLanguagePack();

export function useLanguagePack(): Live<LanguagePackView> {
  return useLiveValue('language-pack-changed', loadLanguagePack);
}
