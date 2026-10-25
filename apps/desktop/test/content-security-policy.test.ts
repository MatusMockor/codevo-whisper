import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { CONTENT_SECURITY_POLICY } from '../src/main/security/content-security-policy';

describe('content security policy', () => {
  it.each(['../src/renderer/index.html', '../src/renderer/capture/capture.html'])('uses the response header policy in the %s meta tag', async (page) => {
    const html = await readFile(new URL(page, import.meta.url), 'utf8');

    expect(html).toContain(`<meta http-equiv="Content-Security-Policy" content="${CONTENT_SECURITY_POLICY}" />`);
  });
});
