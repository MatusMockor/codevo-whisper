import { fileURLToPath } from 'node:url';

export function desktopAppRoot(): string {
  return fileURLToPath(new URL('../..', import.meta.url));
}
