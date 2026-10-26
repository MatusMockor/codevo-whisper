import type { ErrorCode } from '@codevo-whisper/protocol';

export type RemoteFailureKind =
  | 'not-paired'
  | 'offline'
  | 'timeout'
  | 'device-unknown'
  | 'server-key-changed'
  | 'busy'
  | 'stt-unavailable'
  | 'too-long'
  | 'connection-lost'
  | 'protocol'
  | 'storage-insecure'
  | 'pairing-closed'
  | 'pairing-rejected';

export class RemoteFailure extends Error {
  override readonly name = 'RemoteFailure';

  constructor(
    readonly kind: RemoteFailureKind,
    message: string = kind,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

const KIND_BY_CODE: Readonly<Record<ErrorCode, RemoteFailureKind>> = Object.freeze({
  bad_message: 'protocol',
  unknown_device: 'device-unknown',
  revoked: 'device-unknown',
  busy: 'busy',
  stt_unavailable: 'stt-unavailable',
  too_long: 'too-long',
  session_expired: 'connection-lost',
  pairing_closed: 'pairing-closed',
  pairing_rejected: 'pairing-rejected',
  server_key_changed: 'server-key-changed',
});

export function failureForCode(code: ErrorCode): RemoteFailureKind {
  return KIND_BY_CODE[code];
}

export function asRemoteFailure(error: unknown, fallback: RemoteFailureKind): RemoteFailure {
  if (error instanceof RemoteFailure) {
    return error;
  }
  return new RemoteFailure(fallback, error instanceof Error ? error.message : String(error), { cause: error });
}
