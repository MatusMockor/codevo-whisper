import { sep } from 'node:path';

export function homeRelativePath(path: string, home: string): string {
  if (home === '') {
    return path;
  }
  if (path === home) {
    return '~';
  }
  if (!path.startsWith(`${home}${sep}`)) {
    return path;
  }
  return `~${path.slice(home.length)}`;
}
