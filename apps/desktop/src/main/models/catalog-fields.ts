import { isPlainRecord } from '../settings/settings-fields';
import { CatalogError } from './catalog-error';

export type Guard<T> = (value: unknown) => value is T;

const MAX_TEXT_LENGTH = 2048;

export function isText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= MAX_TEXT_LENGTH;
}

export function matching(pattern: RegExp): Guard<string> {
  return (value: unknown): value is string => typeof value === 'string' && pattern.test(value);
}

export function oneOf<T extends string>(allowed: readonly T[]): Guard<T> {
  return (value: unknown): value is T => allowed.some((option) => option === value);
}

export function isPositiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

export function isHttpsUrl(value: unknown): value is string {
  return isText(value) && URL.canParse(value) && new URL(value).protocol === 'https:';
}

export function listOf<T>(item: Guard<T>): Guard<T[]> {
  return (value: unknown): value is T[] => Array.isArray(value) && value.length > 0 && value.every((entry) => item(entry));
}

export function requireRecord(value: unknown, where: string): Record<string, unknown> {
  if (!isPlainRecord(value)) {
    throw new CatalogError(`${where} must be an object`);
  }
  return value;
}

export function field<T>(record: Record<string, unknown>, key: string, guard: Guard<T>, where: string): T {
  const value = record[key];
  if (!guard(value)) {
    throw new CatalogError(`${where}: missing or invalid ${key}`);
  }
  return value;
}
