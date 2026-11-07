import { CAPTURE_LIMITS, type CaptureReply, type CaptureStartResult, type MeetingCaptureResult, type MeetingFrame, type RawAudioDevice } from '../../shared/capture-contract';
import { PCM_BYTES_PER_SAMPLE } from '../../shared/pcm';
import { IpcValidationError } from '../ipc/validate';
import { isPlainRecord } from '../settings/settings-fields';

function hasOnlyKeys(record: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(record).every((key) => keys.includes(key));
}

function isBoundedText(value: unknown): value is string {
  return typeof value === 'string' && value.length <= CAPTURE_LIMITS.maxTextLength;
}

export function parseFrame(value: unknown): Uint8Array {
  if (!(value instanceof Uint8Array)) {
    throw new IpcValidationError('PCM frame must be bytes');
  }
  if (value.byteLength === 0 || value.byteLength > CAPTURE_LIMITS.maxFrameBytes || value.byteLength % PCM_BYTES_PER_SAMPLE !== 0) {
    throw new IpcValidationError('PCM frame has an invalid size');
  }
  return value;
}

export function parseLevel(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new IpcValidationError('Level must be a number between 0 and 1');
  }
  return value;
}

function parseDevice(value: unknown): RawAudioDevice {
  if (!isPlainRecord(value) || !hasOnlyKeys(value, ['deviceId', 'label'])) {
    throw new IpcValidationError('Device must be a plain object');
  }
  const { deviceId, label } = value;
  if (!isBoundedText(deviceId) || !isBoundedText(label)) {
    throw new IpcValidationError('Device fields must be bounded strings');
  }
  return { deviceId, label };
}

export function parseDeviceList(value: unknown): RawAudioDevice[] {
  if (!Array.isArray(value) || value.length > CAPTURE_LIMITS.maxDevices) {
    throw new IpcValidationError('Device list must be a bounded array');
  }
  return value.map((device: unknown) => parseDevice(device));
}

export function parseStartResult(value: unknown): CaptureStartResult {
  if (!isPlainRecord(value) || !isBoundedText(value['label']) || typeof value['fallback'] !== 'boolean') {
    throw new IpcValidationError('Start result must carry a label and a fallback flag');
  }
  return { label: value['label'], fallback: value['fallback'] };
}

const MEETING_SYSTEM_STATES: ReadonlyArray<MeetingCaptureResult['system']> = ['recording', 'failed', 'off'];

export function parseMeetingFrame(value: unknown): MeetingFrame {
  if (!isPlainRecord(value) || !hasOnlyKeys(value, ['track', 'pcm'])) {
    throw new IpcValidationError('Meeting frame must be a plain object');
  }
  const { track } = value;
  if (track !== 'mic' && track !== 'system') {
    throw new IpcValidationError('Meeting frame has an unknown track');
  }
  return { track, pcm: parseFrame(value['pcm']) };
}

export function parseMeetingStartResult(value: unknown): MeetingCaptureResult {
  const started = parseStartResult(value);
  const system = MEETING_SYSTEM_STATES.find((state) => isPlainRecord(value) && value['system'] === state);
  if (system === undefined) {
    throw new IpcValidationError('Meeting start result must carry a system audio state');
  }
  return { ...started, system };
}

function isRequestId(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

export function parseReply(value: unknown): CaptureReply {
  if (!isPlainRecord(value) || !isRequestId(value['id'])) {
    throw new IpcValidationError('Reply must carry a request id');
  }
  const id = value['id'];
  if (value['ok'] === true) {
    return { id, ok: true, value: value['value'] };
  }
  if (value['ok'] !== false || typeof value['error'] !== 'string') {
    throw new IpcValidationError('Reply must be a success or an error');
  }
  return { id, ok: false, error: value['error'].slice(0, CAPTURE_LIMITS.maxErrorLength) };
}
