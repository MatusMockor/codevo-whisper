import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config';

describe('loadConfig', () => {
  it('uses defaults', () => {
    expect(loadConfig({})).toEqual({
      bind: '127.0.0.1',
      port: 8787,
      dataDir: '/data',
      adminSocket: '/run/codevo-whisper/admin.sock',
      sttUrl: 'http://stt:8001',
      publicEndpoint: 'ws://127.0.0.1:8787',
      trustedProxyHeader: null,
    });
  });

  it('reads overrides from the environment', () => {
    expect(
      loadConfig({
        CW_BIND: '10.8.0.1',
        CW_PORT: '9000',
        CW_DATA_DIR: '/srv/cw',
        CW_ADMIN_SOCKET: '/tmp/cw.sock',
        CW_STT_URL: 'http://127.0.0.1:8001',
        CW_PUBLIC_ENDPOINT: 'wss://whisper.example.com',
        CW_TRUSTED_PROXY_HEADER: 'CF-Connecting-IP',
      }),
    ).toEqual({
      bind: '10.8.0.1',
      port: 9000,
      dataDir: '/srv/cw',
      adminSocket: '/tmp/cw.sock',
      sttUrl: 'http://127.0.0.1:8001',
      publicEndpoint: 'wss://whisper.example.com',
      trustedProxyHeader: 'cf-connecting-ip',
    });
  });

  it('rejects an invalid trusted proxy header name', () => {
    expect(() => loadConfig({ CW_TRUSTED_PROXY_HEADER: 'bad header' })).toThrow(/CW_TRUSTED_PROXY_HEADER/);
  });

  it('rejects a non-numeric port', () => {
    expect(() => loadConfig({ CW_PORT: 'abc' })).toThrow(/CW_PORT/);
    expect(() => loadConfig({ CW_PORT: '80.5' })).toThrow(/CW_PORT/);
    expect(() => loadConfig({ CW_PORT: '70000' })).toThrow(/CW_PORT/);
  });

  it('rejects a public endpoint that is not ws:// or wss:// and an STT URL that is not http', () => {
    expect(() => loadConfig({ CW_PUBLIC_ENDPOINT: 'https://whisper.example.com' })).toThrow(/CW_PUBLIC_ENDPOINT/);
    expect(() => loadConfig({ CW_STT_URL: 'stt:8001' })).toThrow(/CW_STT_URL/);
  });
});
