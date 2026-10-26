import { describe, expect, it } from 'vitest';
import { connectTime, pairedOn, statusPill } from '../src/renderer/server/server-copy';

describe('server copy', () => {
  it('labels every server status', () => {
    expect(statusPill({ kind: 'online', connectMs: 38, serverVersion: '0.1.0' })).toEqual({ label: 'Online', tone: 'ok' });
    expect(statusPill({ kind: 'offline' })).toEqual({ label: 'Nedostupný', tone: 'warn' });
    expect(statusPill({ kind: 'repair-needed', reason: 'server-key-changed' })).toEqual({ label: 'Treba znova spárovať', tone: 'warn' });
    expect(statusPill({ kind: 'checking' })).toEqual({ label: 'Overujem…', tone: 'muted' });
    expect(statusPill({ kind: 'unknown' })).toEqual({ label: 'Neoverené', tone: 'muted' });
  });

  it('formats the pairing date and the connect time', () => {
    expect(pairedOn('2026-10-12T10:00:00.000Z')).toBe('Spárované 12. októbra 2026');
    expect(pairedOn('not a date')).toBe('');
    expect(connectTime({ kind: 'online', connectMs: 44, serverVersion: '0.1.0' })).toBe('44 ms');
    expect(connectTime({ kind: 'offline' })).toBe('–');
  });
});
