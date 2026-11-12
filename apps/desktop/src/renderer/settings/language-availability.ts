import type { DictationLanguage } from '../../shared/dictation-languages';
import type { PairedServerView } from '../../shared/server';
import { languageCoverage } from '../../shared/server-languages';
import type { EngineId } from '../../shared/settings';

export type AvailabilityNote = { text: string; warn: boolean };

const SERVER_SUPPORTS: AvailabilityNote = Object.freeze({ text: 'Server podporuje výber jazykov.', warn: false });

const SERVER_MISSING_MODELS: AvailabilityNote = Object.freeze({ text: 'Na serveri chýbajú modely pre výber jazykov. Spustite na serveri stt-provision.', warn: true });

function outdatedServer(serverVersion: string, minVersion: string): AvailabilityNote {
  return { text: `Server je zastaraný (verzia ${serverVersion}). Výber jazykov funguje od verzie ${minVersion}, aktualizujte server.`, warn: true };
}

export function serverAvailabilityNote(server: Pick<PairedServerView, 'status'> | null, engineOrder: readonly EngineId[], selected: readonly DictationLanguage[]): AvailabilityNote | null {
  if (server === null || !engineOrder.includes('server') || server.status.kind !== 'online') {
    return null;
  }
  const { serverVersion, languages } = server.status;
  if (languages.kind === 'outdated') {
    return outdatedServer(serverVersion, languages.minVersion);
  }
  return languageCoverage(languages, selected) === 'covered' ? SERVER_SUPPORTS : SERVER_MISSING_MODELS;
}
