import { useLiveValue, type Live } from './live-value';

const loadLastTranscript = () => window.codevo.getLastTranscript();

export function useLastTranscript(): Live<string | null> {
  return useLiveValue('last-transcript-changed', loadLastTranscript);
}
