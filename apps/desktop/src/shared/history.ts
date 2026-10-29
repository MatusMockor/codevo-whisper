export const HISTORY_LIMITS = [10, 50, 100, 500] as const;
export type HistoryLimit = (typeof HISTORY_LIMITS)[number];
export type HistoryPolicy = { enabled: boolean; limit: HistoryLimit };
export type HistoryEntry = { id: string; completedAt: number; text: string };
export type HistoryView =
  | { kind: 'ready'; policy: HistoryPolicy; entries: HistoryEntry[]; writeError: boolean }
  | { kind: 'unavailable' };
