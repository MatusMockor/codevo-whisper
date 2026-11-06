import type { MeetingTrack } from './meetings';

export type RawAudioDevice = { deviceId: string; label: string };

export type CaptureMode = 'record' | 'meter';

export type CaptureRequest =
  | { type: 'list-devices' }
  | { type: 'start'; deviceId: string | null; mode: CaptureMode }
  | { type: 'stop' }
  | { type: 'meeting-start'; deviceId: string | null; system: boolean }
  | { type: 'meeting-stop' };

export type CaptureCommand = CaptureRequest & { id: number };

export type CaptureReply = { id: number; ok: true; value: unknown } | { id: number; ok: false; error: string };

export type CaptureStartResult = { label: string; fallback: boolean };

export type MeetingCaptureResult = CaptureStartResult & { system: 'recording' | 'failed' | 'off' };

export type MeetingFrame = { track: MeetingTrack; pcm: Uint8Array };

export type CaptureBridge = {
  onCommand(listener: (command: CaptureCommand) => void): void;
  reply(reply: CaptureReply): void;
  frame(pcm: Uint8Array): void;
  meetingFrame(frame: MeetingFrame): void;
  level(rms: number): void;
  devicesChanged(devices: RawAudioDevice[]): void;
};

export const CAPTURE_CHANNELS = Object.freeze({
  command: 'capture:command',
  reply: 'capture:reply',
  frame: 'capture:frame',
  meetingFrame: 'capture:meeting-frame',
  level: 'capture:level',
  devices: 'capture:devices-changed',
});

export const CAPTURE_LIMITS = Object.freeze({
  maxFrameBytes: 6400,
  maxDevices: 64,
  maxTextLength: 512,
  maxErrorLength: 256,
});

export const PCM_PROCESSOR_NAME = 'codevo-pcm-capture';
