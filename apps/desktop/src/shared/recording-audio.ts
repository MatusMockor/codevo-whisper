import type { Settings } from './settings';

export type RecordingAudioSettings = Pick<Settings, 'muteWhileRecording' | 'audioFeedback' | 'feedbackOutputId' | 'feedbackVolume'>;

export type AudioOutput = { id: string; label: string };

export type OutputAudioView =
  | { kind: 'available'; outputs: readonly AudioOutput[]; canMute: boolean }
  | { kind: 'unavailable'; reason: 'platform' | 'device' };

export interface RecordingAudioLease {
  finish(options: { playStop: boolean }): Promise<void>;
}
