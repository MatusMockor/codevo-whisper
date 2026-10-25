export type LanguageHint = 'ignored' | 'required' | 'optional';

export type ModelStatus = 'not-downloaded' | 'downloading' | 'paused' | 'ready' | 'broken';

export type ModelState = { id: string; status: ModelStatus; receivedBytes: number; totalBytes: number };

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
