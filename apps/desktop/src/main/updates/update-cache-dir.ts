import { readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

export interface UpdateCacheLocator {
  cacheDir(): Promise<string | null>;
}

export type CacheBaseFacts = { platform: NodeJS.Platform; home: string; xdgCacheHome: string | undefined };

export type AppUpdateConfigLocation = { resourcesPath: string; base: string | null };

const APP_UPDATE_CONFIG = 'app-update.yml';

const DIR_NAME = /^updaterCacheDirName:[ \t]*(.*?)[ \t]*$/m;

const QUOTED = /^(['"])(.*)\1$/;

export function appCacheBase({ platform, home, xdgCacheHome }: CacheBaseFacts): string | null {
  if (platform === 'darwin') {
    return join(home, 'Library', 'Caches');
  }
  if (platform !== 'linux') {
    return null;
  }
  return xdgCacheHome !== undefined && xdgCacheHome !== '' ? xdgCacheHome : join(home, '.cache');
}

function unquote(value: string): string {
  const quoted = QUOTED.exec(value);
  return quoted === null ? value : (quoted[2] ?? '');
}

export function updaterCacheDirName(config: string): string | null {
  const raw = DIR_NAME.exec(config)?.[1];
  if (raw === undefined) {
    return null;
  }
  const name = unquote(raw);
  if (name === '' || name === '.' || name === '..' || basename(name) !== name) {
    return null;
  }
  return name;
}

export class AppUpdateConfigCacheLocator implements UpdateCacheLocator {
  constructor(private readonly location: AppUpdateConfigLocation) {}

  async cacheDir(): Promise<string | null> {
    const { base, resourcesPath } = this.location;
    if (base === null) {
      return null;
    }
    const name = updaterCacheDirName(await readFile(join(resourcesPath, APP_UPDATE_CONFIG), 'utf8'));
    return name === null ? null : join(base, name);
  }
}
