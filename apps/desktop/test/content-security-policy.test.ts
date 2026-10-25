import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { CONTENT_SECURITY_POLICY } from '../src/main/security/content-security-policy';

describe('content security policy', () => {
  it('uses the same policy in the index.html meta tag and the response header', async () => {
    const html = await readFile(new URL('../src/renderer/index.html', import.meta.url), 'utf8');

    expect(html).toContain(`<meta http-equiv="Content-Security-Policy" content="${CONTENT_SECURITY_POLICY}" />`);
  });
});
