import { describe, expect, it } from 'vitest';
import { LANGUAGE_SETS_MIN_VERSION, VOCABULARY_MIN_VERSION } from '@codevo-whisper/protocol';
import { SERVER_VERSION } from '../../server/src/version';
import { ServerFeatures } from '../src/main/remote/server-features';

describe('ServerFeatures', () => {
  it.each(['0.3.0', '0.3.1', '0.10.0', '1.0.0'])('offers language sets on server %s', (version) => {
    expect(ServerFeatures.of(version).languageSets).toBe(true);
  });

  it.each(['0.2.0', '0.2.99', '0.3.0-rc.1', '0.0.9'])('treats server %s as too old for language sets', (version) => {
    expect(ServerFeatures.of(version).languageSets).toBe(false);
  });

  it.each(['', 'dev', '0.3', 'v0.3.0', '0.3.0.1'])('treats the unreadable version %j as too old', (version) => {
    expect(ServerFeatures.of(version).languageSets).toBe(false);
  });

  it('gates on the protocol minimum, which the bundled server meets', () => {
    expect(ServerFeatures.languageSetsMinVersion).toBe(LANGUAGE_SETS_MIN_VERSION);
    expect(ServerFeatures.of(SERVER_VERSION).languageSets).toBe(true);
    expect(ServerFeatures.of(VOCABULARY_MIN_VERSION).vocabulary).toBe(true);
    expect(ServerFeatures.of(SERVER_VERSION).vocabulary).toBe(true);
  });

  it.each(['0.4.0', '0.4.1', '0.10.0', '1.0.0'])('offers the dictation vocabulary on server %s', (version) => {
    expect(ServerFeatures.of(version).vocabulary).toBe(true);
  });

  it.each(['0.3.0', '0.3.9', '0.4.0-rc.1', '', 'dev'])('treats server %j as too old for the dictation vocabulary', (version) => {
    expect(ServerFeatures.of(version).vocabulary).toBe(false);
  });
});
