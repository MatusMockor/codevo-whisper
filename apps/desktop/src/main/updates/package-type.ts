import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export function readPackageType(resourcesPath: string): string | null {
  try {
    const type = readFileSync(join(resourcesPath, 'package-type'), 'utf8').trim();
    return type === '' ? null : type;
  } catch {
    return null;
  }
}
