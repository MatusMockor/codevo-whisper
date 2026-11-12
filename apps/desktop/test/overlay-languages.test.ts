import { describe, expect, it } from 'vitest';
import { languageChip, readinessError } from '../src/main/session/overlay-messages';
import type { EngineConditions } from '../src/shared/engine-routing';

const CONDITIONS: EngineConditions = { localReady: true, serverReady: true, serverOffline: false, serverOff: false, serverRepair: false };

describe('overlay language chip', () => {
  it('shows AUTO in automatic mode and the primary language with the count of the others otherwise', () => {
    expect(languageChip({ mode: 'auto', selected: ['sk', 'cs'] })).toBe('AUTO');
    expect(languageChip({ mode: 'selected', selected: ['sk'] })).toBe('SK');
    expect(languageChip({ mode: 'selected', selected: ['sk', 'cs', 'en'] })).toBe('SK +2');
    expect(languageChip({ mode: 'selected', selected: ['uk', 'ru'] })).toBe('UK +1');
  });
});

describe('overlay language readiness errors', () => {
  it('explains each language reason with its fix', () => {
    expect(readinessError('languages-required', CONDITIONS)).toEqual({ kind: 'error', message: 'Zvolený model potrebuje zvolené jazyky.', action: 'open-settings' });
    expect(readinessError('languages-pack-missing', CONDITIONS)).toEqual({ kind: 'error', message: 'Pre zvolené jazyky chýbajú modely. Stiahnite ich v Nastaveniach.', action: 'open-settings' });
    expect(readinessError('server-languages-outdated', CONDITIONS)).toEqual({ kind: 'error', message: 'Server nepozná výber jazykov. Aktualizujte ho alebo zapnite Automaticky.', action: 'open-server' });
  });
});
