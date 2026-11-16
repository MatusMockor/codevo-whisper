import type { TranscriptionModelOption } from '@codevo-whisper/protocol';

export type { TranscriptionModelOption };

function offeredChoice(offered: readonly TranscriptionModelOption[], choice: string | null): TranscriptionModelOption | undefined {
  return offered.find((option) => option.id === choice && option.available);
}

export function effectiveTranscriptionModel(offered: readonly TranscriptionModelOption[], choice: string | null): TranscriptionModelOption | null {
  return offeredChoice(offered, choice) ?? offered.find((option) => option.default) ?? null;
}

export function requestedTranscriptionModel(offered: readonly TranscriptionModelOption[], choice: string | null): string | undefined {
  return offeredChoice(offered, choice)?.id;
}
