import { isAiConfigured, isLocalAddress } from '../../shared/ai';
import type { PairedServerView } from '../../shared/server';
import type { EngineId, Settings } from '../../shared/settings';
import type { SignalState } from '../home/transcription-route';
import { AI_SECTION, MODEL_SECTION, SERVER_SECTION, type NavTarget } from '../navigation';

export type ZoneStatus = { tone: SignalState; label: string };

export type ZoneAction = { label: string; target: NavTarget };

export type ZoneState = { status: ZoneStatus | null; path: readonly string[]; action: ZoneAction | null };

export type ZoneId = 'local' | 'server' | 'ai';

export type PrivacyZones = Readonly<Record<ZoneId, ZoneState>>;

export type VoiceRoute = { primary: EngineId; fallback: EngineId | null } | null;

export type PrivacyView = { zones: PrivacyZones; route: VoiceRoute };

export type ZoneSettings = Pick<Settings, 'engineOrder' | 'aiProvider' | 'aiBaseUrl' | 'aiModel' | 'aiPolish'>;

const OPEN_MODEL: ZoneAction = Object.freeze({ label: 'Otvoriť lokálny model', target: MODEL_SECTION });

const OPEN_SERVER: ZoneAction = Object.freeze({ label: 'Otvoriť server', target: SERVER_SECTION });

const PAIR_SERVER: ZoneAction = Object.freeze({ label: 'Spárovať server', target: SERVER_SECTION });

const OPEN_AI: ZoneAction = Object.freeze({ label: 'Otvoriť AI úpravu', target: AI_SECTION });

const SET_UP_AI: ZoneAction = Object.freeze({ label: 'Nastaviť AI úpravu', target: AI_SECTION });

const LOCAL_PATH: readonly string[] = Object.freeze(['Mikrofón', 'Lokálny model', 'Aplikácia']);

const serverPath = (host: string): readonly string[] => ['Zvuk', 'E2E šifrovanie', host];

const aiPath = (destination: string): readonly string[] => ['Text', destination];

export const UNKNOWN_ZONES: PrivacyZones = Object.freeze({
  local: { status: null, path: LOCAL_PATH, action: null },
  server: { status: null, path: serverPath('váš server'), action: null },
  ai: { status: null, path: aiPath('AI poskytovateľ'), action: null },
});

export const UNKNOWN_PRIVACY: PrivacyView = Object.freeze({ zones: UNKNOWN_ZONES, route: null });

function routeRole(order: readonly EngineId[], engine: EngineId): string | null {
  const position = order.indexOf(engine);
  if (position === -1) {
    return null;
  }
  return position === 0 ? 'Teraz hlavný prepis' : 'Teraz záloha prepisu';
}

export function localZone(order: readonly EngineId[]): ZoneState {
  const role = routeRole(order, 'local');
  return { status: role === null ? { tone: 'off', label: 'Lokálny prepis nie je v trase' } : { tone: 'ok', label: role }, path: LOCAL_PATH, action: OPEN_MODEL };
}

export function serverZone(order: readonly EngineId[], server: PairedServerView | null): ZoneState {
  if (server === null) {
    return { status: { tone: 'off', label: 'Nepoužíva sa, server nie je spárovaný' }, path: UNKNOWN_ZONES.server.path, action: PAIR_SERVER };
  }
  const role = routeRole(order, 'server');
  const path = serverPath(server.host);
  if (!server.enabled) {
    return { status: { tone: 'off', label: 'Spárovaný, ale odpojený' }, path, action: OPEN_SERVER };
  }
  if (role === null) {
    return { status: { tone: 'off', label: 'Spárovaný, ale nie je v trase prepisu' }, path, action: OPEN_SERVER };
  }
  return { status: { tone: 'warn', label: role }, path, action: OPEN_SERVER };
}

function addressHost(address: string): string {
  try {
    return new URL(address).host;
  } catch {
    return 'váš AI server';
  }
}

function aiUse(aiPolish: boolean): string {
  return aiPolish ? 'Teraz diktát aj poznámky zo stretnutí' : 'Teraz iba poznámky zo stretnutí';
}

export function aiZone(settings: Omit<ZoneSettings, 'engineOrder'>): ZoneState {
  if (!isAiConfigured(settings)) {
    return { status: { tone: 'off', label: 'Nepoužíva sa, AI úprava nie je nastavená' }, path: UNKNOWN_ZONES.ai.path, action: SET_UP_AI };
  }
  if (settings.aiProvider === 'codex') {
    return { status: { tone: 'warn', label: aiUse(settings.aiPolish) }, path: aiPath('OpenAI cez Codex CLI'), action: OPEN_AI };
  }
  const address = settings.aiBaseUrl ?? '';
  return { status: { tone: isLocalAddress(address) ? 'ok' : 'warn', label: aiUse(settings.aiPolish) }, path: aiPath(addressHost(address)), action: OPEN_AI };
}

function serverInUse(server: PairedServerView | null): boolean {
  return server !== null && server.enabled;
}

function effectiveOrder(order: readonly EngineId[], server: PairedServerView | null): readonly EngineId[] {
  return order.filter((engine) => engine === 'local' || serverInUse(server));
}

export function voiceRoute(order: readonly EngineId[], server: PairedServerView | null): VoiceRoute {
  const [primary, fallback] = effectiveOrder(order, server);
  if (primary === undefined) {
    return null;
  }
  return { primary, fallback: fallback ?? null };
}

export function privacyView(settings: ZoneSettings, server: PairedServerView | null): PrivacyView {
  return {
    zones: { local: localZone(effectiveOrder(settings.engineOrder, server)), server: serverZone(settings.engineOrder, server), ai: aiZone(settings) },
    route: voiceRoute(settings.engineOrder, server),
  };
}

export function privacyViewWithoutServer(settings: ZoneSettings): PrivacyView {
  return {
    zones: { local: localZone(settings.engineOrder), server: UNKNOWN_ZONES.server, ai: aiZone(settings) },
    route: settings.engineOrder.includes('server') ? null : voiceRoute(settings.engineOrder, null),
  };
}
