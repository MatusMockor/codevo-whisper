export type LanguageHint = 'ignored' | 'required' | 'optional';

export type ModelStatus = 'not-downloaded' | 'downloading' | 'paused' | 'ready' | 'broken';

export type ModelState = { id: string; status: ModelStatus; receivedBytes: number; totalBytes: number };

export function isModelReady(states: readonly ModelState[], id: string | null): boolean {
  return id !== null && states.some((state) => state.id === id && state.status === 'ready');
}

export type ModelInfo = {
  id: string;
  name: string;
  quantization: string;
  sizeBytes: number;
  license: string;
  licenseUrl: string;
  languageHint: LanguageHint;
  roleLabels: readonly string[];
};

export type ModelCatalogView = { models: ModelInfo[]; defaultModelId: string };

export type AuxiliaryModelView = { model: ModelInfo; state: ModelState };

export type DiarizerView = AuxiliaryModelView;

export type LanguagePackView = { conditioned: AuxiliaryModelView; languageId: AuxiliaryModelView; requiredRamBytes: number; enoughMemory: boolean };

export function isLanguagePackReady(pack: LanguagePackView): boolean {
  return pack.conditioned.state.status === 'ready' && pack.languageId.state.status === 'ready';
}
