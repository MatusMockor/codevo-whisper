import type { VadFrame } from './vad-frame';

export interface VoiceActivityDetector {
  process(samples: Int16Array): VadFrame[];
}
