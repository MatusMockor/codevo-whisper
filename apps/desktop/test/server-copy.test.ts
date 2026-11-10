import { describe, expect, it } from 'vitest';
import { pairedOn, pairingStep, statusPill, unreachableHint } from '../src/renderer/server/server-copy';
import { PAIR_COMMAND, revokeCommand } from '../src/shared/server';

describe('server copy', () => {
  it('labels every server status and a disconnected server', () => {
    expect(statusPill({ enabled: true, status: { kind: 'online', connectMs: 38, serverVersion: '0.1.0' } })).toEqual({ label: 'Online', tone: 'ok' });
    expect(statusPill({ enabled: true, status: { kind: 'offline' } })).toEqual({ label: 'Neodpovedá', tone: 'err' });
    expect(statusPill({ enabled: true, status: { kind: 'repair-needed', reason: 'server-key-changed' } })).toEqual({ label: 'Treba znova spárovať', tone: 'err' });
    expect(statusPill({ enabled: true, status: { kind: 'checking' } })).toEqual({ label: 'Overujem…', tone: 'muted' });
    expect(statusPill({ enabled: true, status: { kind: 'unknown' } })).toEqual({ label: 'Neoverené', tone: 'muted' });
    expect(statusPill({ enabled: false, status: { kind: 'offline' } })).toEqual({ label: 'Odpojený', tone: 'muted' });
  });

  it('formats the pairing date', () => {
    expect(pairedOn('2026-10-12T10:00:00.000Z')).toBe('Spárované 12. októbra 2026');
    expect(pairedOn('not a date')).toBe('');
  });

  it('explains an unreachable server and points at an SSH tunnel for a loopback address', () => {
    expect(unreachableHint('ws://127.0.0.1:8787')).toContain('SSH tunel');
    expect(unreachableHint('ws://localhost:8787')).toContain('SSH tunel');
    expect(unreachableHint('ws://[::1]:8787')).toContain('SSH tunel');
    expect(unreachableHint('wss://domaci-pc.tail3f2a.ts.net:8443')).toContain('VPN alebo tunel');
    expect(unreachableHint('not a url')).toContain('VPN alebo tunel');
  });

  it('shows the native pair command on Linux and mentions the Docker variant', () => {
    const linux = pairingStep(true);
    expect(linux.command).toBe('codevo-whisper-server pair');
    expect(linux.note).toContain(PAIR_COMMAND);
    expect(pairingStep(false)).toEqual({ command: PAIR_COMMAND, note: 'Príkaz otvorí párovacie okno na 10 minút a vypíše párovací token, ktorý začína cw1:.' });
  });

  it('gives the native revoke command on Linux and the Docker one elsewhere', () => {
    expect(revokeCommand('ab12cd34', true)).toBe('codevo-whisper-server revoke ab12cd34');
    expect(revokeCommand('ab12cd34', false)).toBe('docker compose -f infrastructure/compose/compose.yaml exec gateway codevo-whisper revoke ab12cd34');
  });
});
