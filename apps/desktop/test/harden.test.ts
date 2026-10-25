import { describe, expect, it } from 'vitest';
import { hardenWebContents } from '../src/main/security/harden';
import { FakeWebContents } from './fake-web-contents';

describe('hardenWebContents', () => {
  it('blocks navigation to external URLs', () => {
    const contents = new FakeWebContents();
    hardenWebContents(contents.asWebContents());

    const event = contents.navigate('https://example.invalid/phishing');

    expect(event.defaultPrevented).toBe(true);
  });

  it('denies window.open', () => {
    const contents = new FakeWebContents();
    hardenWebContents(contents.asWebContents());

    const response = contents.openWindow('https://example.invalid/popup');

    expect(response).toEqual({ action: 'deny' });
  });
});
