import { LANGUAGE_SETS_MIN_VERSION } from '@codevo-whisper/protocol';
import { compareVersions, parseVersion } from '../updates/version-order';

function atLeast(version: string, minimum: string): boolean {
  const actual = parseVersion(version);
  const required = parseVersion(minimum);
  if (actual === null || required === null) {
    return false;
  }
  return compareVersions(actual, required) >= 0;
}

export class ServerFeatures {
  static readonly languageSetsMinVersion = LANGUAGE_SETS_MIN_VERSION;

  private constructor(readonly languageSets: boolean) {}

  static of(serverVersion: string): ServerFeatures {
    return new ServerFeatures(atLeast(serverVersion, ServerFeatures.languageSetsMinVersion));
  }
}
