import type { EngineId } from '../../shared/settings';

export function preferEngine(engine: EngineId): void {
  window.codevo.preferEngine(engine).catch((error: unknown) => console.error('Switching the transcription engine failed', error));
}
