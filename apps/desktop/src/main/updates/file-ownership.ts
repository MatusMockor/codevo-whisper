import type { Stats } from 'node:fs';

export function ownedByUs(stats: Stats): boolean {
  const uid = process.getuid?.();
  return uid === undefined || stats.uid === uid;
}

export function isOwnedDirectory(stats: Stats): boolean {
  return stats.isDirectory() && !stats.isSymbolicLink() && ownedByUs(stats);
}
