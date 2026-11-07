import type { Settings } from './settings';

export type AiKeyState = 'none' | 'stored' | 'vault-unavailable';

export type AiFailure = 'timeout' | 'aborted' | 'unreachable' | 'unauthorized' | 'http' | 'too-large' | 'bad-response' | 'codex-not-found' | 'codex-logged-out' | 'codex-failed';

export type AiCheck = { ok: true; models: string[] } | { ok: false; error: AiFailure };

export type CodexCheck = { ok: true } | { ok: false; error: AiFailure };

export type AiProvider = 'server' | 'codex';

export const CODEX_EFFORTS = Object.freeze(['none', 'low', 'medium', 'high'] as const);

export type CodexEffort = (typeof CODEX_EFFORTS)[number];

const CODEX_MODEL = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/;

const MAX_URL_CHARS = 512;
const MAX_MODEL_CHARS = 200;
const MAX_KEY_CHARS = 4096;
const CONTROL_CHARACTERS = /[\p{Cc}\p{Cf}]/u;

function parseUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

export function isAiBaseUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > MAX_URL_CHARS || value.trim() !== value) {
    return false;
  }
  const url = parseUrl(value);
  return url !== null && (url.protocol === 'http:' || url.protocol === 'https:') && url.username === '' && url.password === '' && url.search === '' && url.hash === '';
}

export function isAiModel(value: unknown): value is string {
  return typeof value === 'string' && value.length <= MAX_MODEL_CHARS && value.trim() === value && !CONTROL_CHARACTERS.test(value);
}

export function isAiKey(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_KEY_CHARS && value.trim() === value && !CONTROL_CHARACTERS.test(value);
}

export function isCodexModel(value: unknown): value is string {
  return typeof value === 'string' && CODEX_MODEL.test(value);
}

export function isAiConfigured(settings: Pick<Settings, 'aiProvider' | 'aiBaseUrl' | 'aiModel'>): boolean {
  return settings.aiProvider === 'codex' || (settings.aiBaseUrl !== null && settings.aiModel !== '');
}

export function canPolish(settings: Pick<Settings, 'aiProvider' | 'aiBaseUrl' | 'aiModel' | 'aiPolish'>): boolean {
  return settings.aiPolish && isAiConfigured(settings);
}

function isPrivateIpv4(host: string): boolean {
  const parts = host.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }
  const [a = -1, b = -1] = parts;
  return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
}

function isPrivateIpv6(host: string): boolean {
  return host === '::1' || /^f[cd][0-9a-f]{0,2}:/.test(host) || /^fe[89ab][0-9a-f]?:/.test(host);
}

export function isLocalAddress(baseUrl: string): boolean {
  const url = parseUrl(baseUrl);
  if (url === null) {
    return false;
  }
  const host = url.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost')) {
    return true;
  }
  if (host.startsWith('[') && host.endsWith(']')) {
    return isPrivateIpv6(host.slice(1, -1));
  }
  return isPrivateIpv4(host);
}
