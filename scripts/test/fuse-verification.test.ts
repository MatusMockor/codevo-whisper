import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FeedError } from '../release/feed-error.ts';
import { DISABLED, ENABLED, expectedFusesFromBuilderConfig, fuseProblems, type FuseWire } from '../release/fuse-verification.ts';

const builderConfig = readFileSync(join(import.meta.dirname, '..', '..', 'apps', 'desktop', 'electron-builder.yml'), 'utf8');

const SPEC_FUSES = {
  runAsNode: false,
  enableNodeOptionsEnvironmentVariable: false,
  enableNodeCliInspectArguments: false,
  enableEmbeddedAsarIntegrityValidation: true,
  onlyLoadAppFromAsar: true,
  enableCookieEncryption: true,
};

const hardenedWire: FuseWire = { 0: DISABLED, 1: ENABLED, 2: DISABLED, 3: DISABLED, 4: ENABLED, 5: ENABLED, 6: DISABLED, 7: ENABLED };

describe('expectedFusesFromBuilderConfig', () => {
  it('electron-builder.yml declares exactly the spec fuse set', () => {
    expect(expectedFusesFromBuilderConfig(builderConfig)).toEqual(SPEC_FUSES);
  });

  it('rejects a config without electronFuses', () => {
    expect(() => expectedFusesFromBuilderConfig('appId: app.codevo.whisper\n')).toThrow(FeedError);
  });

  it('rejects a fuse that is not a boolean', () => {
    expect(() => expectedFusesFromBuilderConfig('electronFuses:\n  runAsNode: maybe\n')).toThrow(/runAsNode/);
  });
});

describe('fuseProblems', () => {
  it('accepts a wire that matches the expectation', () => {
    expect(fuseProblems(SPEC_FUSES, hardenedWire)).toEqual([]);
  });

  it('reports an enabled RunAsNode fuse', () => {
    expect(fuseProblems(SPEC_FUSES, { ...hardenedWire, 0: ENABLED })).toEqual(['runAsNode: expected disabled, found enabled']);
  });

  it('reports a fuse missing from the wire', () => {
    const wire: FuseWire = { ...hardenedWire, 4: undefined };

    expect(fuseProblems(SPEC_FUSES, wire)).toEqual(['enableEmbeddedAsarIntegrityValidation: expected enabled, found missing']);
  });

  it('reports an unknown fuse name', () => {
    expect(fuseProblems({ runAsNodeTypo: false }, hardenedWire)).toEqual(['runAsNodeTypo: unknown fuse']);
  });
});
