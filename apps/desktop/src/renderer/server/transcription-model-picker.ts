import type { PairedServerView } from '../../shared/server';
import { effectiveTranscriptionModel, type TranscriptionModelOption } from '../../shared/transcription-models';

export type ModelChoice = { id: string; label: string; disabled: boolean };

export type ModelPicker = { options: readonly ModelChoice[]; selected: string; description: string | null; missingNote: string | null; routesLanguages: boolean };

type ModelCopy = { description: string; routesLanguages: boolean };

const KNOWN_MODELS: Readonly<Record<string, ModelCopy>> = Object.freeze({
  'parakeet-ultra': { description: 'Najrýchlejší, 25 európskych jazykov. Riadi sa jazykmi diktovania z Nastavení.', routesLanguages: true },
  'whisper-large-v3': { description: 'Najpresnejší pre slovenčinu, ale pomalší. Prvé diktovanie trvá dlhšie, server model najprv načíta.', routesLanguages: false },
});

const PROVISION_HINT = 'Spustite na serveri stt-provision.';

function choiceOf(option: TranscriptionModelOption): ModelChoice {
  if (option.available) {
    return { id: option.id, label: option.name, disabled: false };
  }
  return { id: option.id, label: `${option.name} - nie je stiahnutý`, disabled: true };
}

function missingNote(offered: readonly TranscriptionModelOption[]): string | null {
  const missing = offered.filter((option) => !option.available).map((option) => option.name);
  const [only, ...others] = missing;
  if (only === undefined) {
    return null;
  }
  if (others.length === 0) {
    return `${only} na serveri nie je stiahnutý. ${PROVISION_HINT}`;
  }
  return `Tieto modely na serveri nie sú stiahnuté: ${missing.join(', ')}. ${PROVISION_HINT}`;
}

export function transcriptionModelPicker(server: Pick<PairedServerView, 'status' | 'transcriptionModel'>): ModelPicker | null {
  const { status } = server;
  if (status.kind !== 'online' || status.transcriptionModels.length === 0) {
    return null;
  }
  const offered = status.transcriptionModels;
  const chosen = effectiveTranscriptionModel(offered, server.transcriptionModel);
  const copy = chosen === null ? undefined : KNOWN_MODELS[chosen.id];
  return {
    options: offered.map(choiceOf),
    selected: chosen?.id ?? '',
    description: copy?.description ?? null,
    missingNote: missingNote(offered),
    routesLanguages: copy?.routesLanguages ?? true,
  };
}
