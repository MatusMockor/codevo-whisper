import { describe, expect, it } from 'vitest';
import { isLocalAddress } from '../src/shared/ai';

describe('isLocalAddress', () => {
  it.each([
    'http://127.0.0.1:11434/v1',
    'http://127.8.9.10/v1',
    'http://localhost:1234/v1',
    'http://gpu.localhost/v1',
    'http://[::1]:8080/v1',
    'http://10.0.0.5:8000/v1',
    'http://172.16.0.1/v1',
    'http://172.31.255.255/v1',
    'http://192.168.1.20:11434/v1',
    'http://169.254.10.10/v1',
    'http://[fd12:3456::1]/v1',
    'http://[fe80::1]/v1',
  ])('keeps %s on this computer or its private network', (url) => {
    expect(isLocalAddress(url)).toBe(true);
  });

  it.each([
    'https://api.openai.com/v1',
    'http://172.32.0.1/v1',
    'http://8.8.8.8/v1',
    'http://192.169.1.1/v1',
    'http://localhost.evil.com/v1',
    'http://127.0.0.1.nip.io/v1',
    'http://[2001:db8::1]/v1',
    'not a url',
  ])('warns that %s is outside this computer', (url) => {
    expect(isLocalAddress(url)).toBe(false);
  });
});
