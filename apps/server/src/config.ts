export type ServerConfig = {
  bind: string;
  port: number;
  dataDir: string;
  adminSocket: string;
  sttUrl: string;
  publicEndpoint: string;
};

const DEFAULTS = {
  CW_BIND: '127.0.0.1',
  CW_PORT: '8787',
  CW_DATA_DIR: '/data',
  CW_ADMIN_SOCKET: '/run/codevo-whisper/admin.sock',
  CW_STT_URL: 'http://stt:8001',
  CW_PUBLIC_ENDPOINT: 'ws://127.0.0.1:8787',
} as const;

type ConfigKey = keyof typeof DEFAULTS;

function read(env: NodeJS.ProcessEnv, key: ConfigKey): string {
  const value = env[key]?.trim();
  if (value === undefined || value === '') {
    return DEFAULTS[key];
  }
  return value;
}

function parsePort(value: string): number {
  const port = Number(value);
  if (!/^\d+$/.test(value) || port > 65535) {
    throw new Error(`CW_PORT must be an integer between 0 and 65535, got "${value}"`);
  }
  return port;
}

function parseUrl(key: ConfigKey, value: string, protocols: string[]): string {
  if (!URL.canParse(value) || !protocols.includes(new URL(value).protocol)) {
    throw new Error(`${key} must be a ${protocols.map((protocol) => `${protocol}//`).join(' or ')} URL`);
  }
  return value;
}

export function loadConfig(env: NodeJS.ProcessEnv): ServerConfig {
  return {
    bind: read(env, 'CW_BIND'),
    port: parsePort(read(env, 'CW_PORT')),
    dataDir: read(env, 'CW_DATA_DIR'),
    adminSocket: read(env, 'CW_ADMIN_SOCKET'),
    sttUrl: parseUrl('CW_STT_URL', read(env, 'CW_STT_URL'), ['http:', 'https:']),
    publicEndpoint: parseUrl('CW_PUBLIC_ENDPOINT', read(env, 'CW_PUBLIC_ENDPOINT'), ['ws:', 'wss:']),
  };
}
