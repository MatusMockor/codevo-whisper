import type { SignalState } from '../home/transcription-route';

type LedProps = { state: SignalState; large?: boolean };

export function Led({ state, large = false }: LedProps) {
  return <span className={large ? `led lg ${state}` : `led ${state}`} aria-hidden="true" />;
}
