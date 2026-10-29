import { HISTORY_LIMITS, type HistoryEntry, type HistoryPolicy } from '../../shared/history';
import { isPlainRecord } from '../settings/settings-fields';

export type HistoryFile = { version: 1; policy: HistoryPolicy; entries: HistoryEntry[] };

export function isHistoryPolicy(value: unknown): value is HistoryPolicy {
  return isPlainRecord(value) && Object.keys(value).length === 2
    && typeof value['enabled'] === 'boolean'
    && HISTORY_LIMITS.some((limit) => limit === value['limit']);
}

export function isHistoryEntryId(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function toEntry(value: unknown): HistoryEntry | null {
  if (!isPlainRecord(value)) return null;
  const { id, completedAt, text } = value;
  if (!isHistoryEntryId(id) || typeof completedAt !== 'number' || !Number.isSafeInteger(completedAt) || completedAt < 0
    || typeof text !== 'string' || text.trim() === '') return null;
  return { id, completedAt, text };
}

export function parseHistoryFile(text: string): HistoryFile | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isPlainRecord(parsed) || parsed['version'] !== 1 || !isHistoryPolicy(parsed['policy']) || !Array.isArray(parsed['entries'])) return null;
  const entries = parsed['entries'].map(toEntry);
  if (entries.some((entry) => entry === null)) return null;
  const valid = entries.filter((entry): entry is HistoryEntry => entry !== null);
  if (valid.length > parsed['policy'].limit || (!parsed['policy'].enabled && valid.length > 0) || new Set(valid.map((entry) => entry.id)).size !== valid.length) return null;
  return { version: 1, policy: { ...parsed['policy'] }, entries: valid };
}
