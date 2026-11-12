import { isLanguagePackReady, type LanguagePackView, type ModelInfo } from '../../shared/models';
import type { EngineId } from '../../shared/settings';
import { requiresLanguage } from './language-options';
import { formatSize } from './model-rows';

export type PackDownload = 'offer' | 'busy' | 'none';

export type PackNoteView = { text: string; warn: boolean; download: PackDownload; progress: number | null };

function packProgress(pack: LanguagePackView): number {
  const parts = [pack.conditioned.state, pack.languageId.state];
  const total = parts.reduce((sum, state) => sum + state.totalBytes, 0);
  const received = parts.reduce((sum, state) => sum + Math.min(state.receivedBytes, state.totalBytes), 0);
  return total > 0 ? received / total : 0;
}

function downloading(pack: LanguagePackView): boolean {
  return pack.conditioned.state.status === 'downloading' || pack.languageId.state.status === 'downloading';
}

function offerText(pack: LanguagePackView): string {
  const { conditioned, languageId } = pack;
  return `Pre výber jazykov treba stiahnuť ${conditioned.model.name} (${formatSize(conditioned.model.sizeBytes)}) a rozpoznávanie jazyka (${formatSize(languageId.model.sizeBytes)}).`;
}

export function languagePackNote(pack: LanguagePackView | null, engineOrder: readonly EngineId[], activeModel: ModelInfo | null): PackNoteView | null {
  if (pack === null || !engineOrder.includes('local') || requiresLanguage(activeModel?.languageHint) || isLanguagePackReady(pack)) {
    return null;
  }
  if (!pack.enoughMemory) {
    return { text: `Výber jazykov na tomto počítači nie je dostupný. Potrebuje aspoň ${formatSize(pack.requiredRamBytes)} pamäte.`, warn: true, download: 'none', progress: null };
  }
  if (downloading(pack)) {
    const progress = packProgress(pack);
    return { text: `Sťahujú sa modely pre výber jazykov, ${Math.floor(progress * 100)} %.`, warn: false, download: 'busy', progress };
  }
  return { text: offerText(pack), warn: false, download: 'offer', progress: null };
}
