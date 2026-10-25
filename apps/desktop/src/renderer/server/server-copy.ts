import type { PairingFailure, ServerStatus, VaultAvailability } from '../../shared/server';

export type PillTone = 'ok' | 'warn' | 'muted';

export function statusPill(status: ServerStatus): { label: string; tone: PillTone } {
  if (status.kind === 'online') {
    return { label: 'Online', tone: 'ok' };
  }
  if (status.kind === 'offline') {
    return { label: 'Nedostupný', tone: 'warn' };
  }
  if (status.kind === 'repair-needed') {
    return { label: 'Treba znova spárovať', tone: 'warn' };
  }
  if (status.kind === 'checking') {
    return { label: 'Overujem…', tone: 'muted' };
  }
  return { label: 'Neoverené', tone: 'muted' };
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

export function connectTime(status: ServerStatus): string {
  return status.kind === 'online' ? `${status.connectMs} ms` : '–';
}
