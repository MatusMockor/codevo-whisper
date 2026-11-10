import { PAIR_COMMAND, type PairedServerView, type PairingFailure, type ServerStatus, type VaultAvailability } from '../../shared/server';

export type PillTone = 'ok' | 'err' | 'amber' | 'muted';

export type StatusPill = { label: string; tone: PillTone };

const STATUS_PILLS: Readonly<Record<Exclude<ServerStatus['kind'], 'unavailable'>, StatusPill>> = Object.freeze({
  online: { label: 'Online', tone: 'ok' },
  offline: { label: 'Neodpovedá', tone: 'err' },
  'repair-needed': { label: 'Treba znova spárovať', tone: 'err' },
  checking: { label: 'Overujem…', tone: 'muted' },
  unknown: { label: 'Neoverené', tone: 'muted' },
});

const UNAVAILABLE_PILLS: Readonly<Record<Extract<ServerStatus, { kind: 'unavailable' }>['reason'], StatusPill>> = Object.freeze({
  busy: { label: 'Zaneprázdnený', tone: 'amber' },
  failed: { label: 'Odpovedá chybou', tone: 'err' },
});

const DISCONNECTED: StatusPill = Object.freeze({ label: 'Odpojený', tone: 'muted' });

export function statusPill(server: Pick<PairedServerView, 'status' | 'enabled'>): StatusPill {
  if (!server.enabled) {
    return DISCONNECTED;
  }
  if (server.status.kind === 'unavailable') {
    return UNAVAILABLE_PILLS[server.status.reason];
  }
  return STATUS_PILLS[server.status.kind];
}

export const UNAVAILABLE_MESSAGES: Readonly<Record<Extract<ServerStatus, { kind: 'unavailable' }>['reason'], { title: string; text: string }>> = Object.freeze({
  busy: { title: 'Server je zaneprázdnený', text: 'Server má otvorený najvyšší povolený počet spojení naraz. Keď sa niektoré uvoľní, spojenie sa obnoví.' },
  failed: { title: 'Server odpovedal chybou', text: 'Server je dostupný, ale spojenie neprebehlo podľa očakávania. Skontrolujte, či na serveri beží aktuálna verzia Codevo Whisper.' },
});

const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(['127.0.0.1', 'localhost', '[::1]']);

export function unreachableHint(endpoint: string): string {
  const host = URL.canParse(endpoint) ? new URL(endpoint).hostname : '';
  if (LOOPBACK_HOSTS.has(host)) {
    return 'Adresa vedie na tento počítač, takže sa k serveru zrejme pripájate cez SSH tunel. Skontrolujte, či tunel beží.';
  }
  return 'Skontrolujte, či server beží a či je zapnutá VPN alebo tunel, cez ktorý sa k nemu pripájate.';
}

export const REPAIR_MESSAGES: Readonly<Record<Extract<ServerStatus, { kind: 'repair-needed' }>['reason'], string>> = Object.freeze({
  'device-unknown': 'Server toto zariadenie nepozná, zrejme bolo na serveri odvolané. Spárujte ho znova.',
  'server-key-changed':
    'Kľúč servera sa zmenil. Codevo Whisper sa k nemu z bezpečnostných dôvodov nepripojí, kým server znova nespárujete. Ak ste kľúč na serveri nemenili, niekto sa môže vydávať za váš server.',
});

export const PAIRING_FAILURES: Readonly<Record<PairingFailure, string>> = Object.freeze({
  'invalid-token': 'Toto nie je platný párovací token. Skopírujte celý riadok, ktorý začína cw1:.',
  unreachable: 'Server na adrese z tokenu sa nepodarilo kontaktovať. Skontrolujte sieť, VPN alebo tunel.',
  'pairing-closed': 'Párovacie okno je zatvorené alebo vypršalo. Spustite párovací príkaz na serveri znova.',
  rejected: 'Párovanie bolo na serveri zamietnuté.',
  'storage-insecure': 'Tento systém nemá bezpečné úložisko kľúčov, preto sa párovanie neuloží.',
  cancelled: 'Párovanie ste zrušili.',
  failed: 'Párovanie sa nepodarilo. Skontrolujte, či token patrí tomuto serveru, a skúste to znova.',
});

export const STORAGE_WARNINGS: Readonly<Record<Exclude<VaultAvailability, 'available'>, string>> = Object.freeze({
  insecure: 'Systém nemá bezpečné úložisko kľúčov (napríklad Kľúčenku). Bez neho Codevo Whisper server nespáruje.',
  unavailable: 'Bezpečné úložisko kľúčov teraz nie je dostupné, server sa nedá spárovať ani použiť.',
});

export function pairedOn(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return `Spárované ${date.toLocaleDateString('sk-SK', { day: 'numeric', month: 'long', year: 'numeric' })}`;
}

const PAIRING_NOTE = 'Príkaz otvorí párovacie okno na 10 minút a vypíše párovací token, ktorý začína cw1:.';

export function pairingStep(linux: boolean): { command: string; note: string } {
  if (linux) {
    return { command: 'codevo-whisper-server pair', note: `${PAIRING_NOTE} Ak server beží v Dockeri, spustite ${PAIR_COMMAND}.` };
  }
  return { command: PAIR_COMMAND, note: PAIRING_NOTE };
}

