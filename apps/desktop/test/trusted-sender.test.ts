import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { isTrustedSenderUrl } from '../src/main/ipc/trusted-sender';

const indexPath = '/Applications/Codevo Whisper.app/Contents/Resources/app.asar/out/renderer/index.html';

describe('isTrustedSenderUrl', () => {
  it('trusts the bundled renderer document', () => {
    const url = pathToFileURL(indexPath).href;

    expect(isTrustedSenderUrl(url, { kind: 'file', path: indexPath })).toBe(true);
    expect(isTrustedSenderUrl(`${url}#settings`, { kind: 'file', path: indexPath })).toBe(true);
  });

  it('rejects other local files', () => {
    expect(isTrustedSenderUrl(pathToFileURL('/tmp/evil.html').href, { kind: 'file', path: indexPath })).toBe(false);
  });

  it('trusts only the dev server origin in development', () => {
    const source = { kind: 'dev-server', url: 'http://localhost:5173/' } as const;

    expect(isTrustedSenderUrl('http://localhost:5173/', source)).toBe(true);
    expect(isTrustedSenderUrl('http://localhost:5174/', source)).toBe(false);
    expect(isTrustedSenderUrl('https://example.invalid/', source)).toBe(false);
  });

  it('rejects a missing or malformed url', () => {
    expect(isTrustedSenderUrl(undefined, { kind: 'file', path: indexPath })).toBe(false);
    expect(isTrustedSenderUrl('not a url', { kind: 'dev-server', url: 'http://localhost:5173/' })).toBe(false);
  });
});
