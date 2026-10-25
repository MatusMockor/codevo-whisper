import { describe, expect, it } from 'vitest';
import { closeCodeFor, errorCodeForClose } from '../src/close-codes';
import { ERROR_CODES } from '../src/errors';

describe('close codes', () => {
  it('maps every error code to a private WebSocket close code and back', () => {
    ERROR_CODES.forEach((code) => {
      const closeCode = closeCodeFor(code);
      expect(closeCode).toBeGreaterThanOrEqual(4000);
      expect(closeCode).toBeLessThan(5000);
      expect(errorCodeForClose(closeCode)).toBe(code);
    });
  });

  it('returns null for codes that carry no protocol error', () => {
    expect(errorCodeForClose(1000)).toBeNull();
    expect(errorCodeForClose(1006)).toBeNull();
    expect(errorCodeForClose(4999)).toBeNull();
  });
});
