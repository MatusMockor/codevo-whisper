import type { UpdateMode } from '../../shared/updates';

export type PlatformFacts = { platform: NodeJS.Platform; isPackaged: boolean; appImage: string | undefined };

export interface PlatformUpdatePolicy {
  mode(facts: PlatformFacts): UpdateMode;
}

const macPolicy: PlatformUpdatePolicy = { mode: () => 'in-app' };

const linuxPolicy: PlatformUpdatePolicy = {
  mode: ({ appImage }) => (appImage !== undefined && appImage !== '' ? 'in-app' : 'manual'),
};

const POLICIES: Partial<Record<NodeJS.Platform, PlatformUpdatePolicy>> = { darwin: macPolicy, linux: linuxPolicy };

export function resolveUpdateMode(facts: PlatformFacts): UpdateMode {
  const policy = POLICIES[facts.platform];
  if (!facts.isPackaged || policy === undefined) {
    return 'unsupported';
  }
  return policy.mode(facts);
}
