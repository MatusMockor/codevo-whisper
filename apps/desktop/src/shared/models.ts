export type LanguageHint = 'ignored' | 'required' | 'optional';

export type ModelStatus = 'not-downloaded' | 'downloading' | 'paused' | 'ready' | 'broken';

export type ModelState = { id: string; status: ModelStatus; receivedBytes: number; totalBytes: number };
