import { describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION } from '../src/index';

describe('protocol', () => {
  it('exposes the protocol version', () => {
    expect(PROTOCOL_VERSION).toBe('cw1');
  });
});
