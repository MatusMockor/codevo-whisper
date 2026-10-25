export type DictationGuard = { isDictating(): boolean; suspend(): Promise<() => void> };
