export const ERROR_CODES = [
  'bad_message',
  'unknown_device',
  'busy',
  'stt_unavailable',
  'too_long',
  'session_expired',
  'revoked',
  'pairing_closed',
  'pairing_rejected',
  'server_key_changed',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export class ProtocolError extends Error {
  override readonly name = 'ProtocolError';

  constructor(
    readonly code: ErrorCode,
    message: string = code,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

export function badMessage(message: string, cause?: unknown): ProtocolError {
  return new ProtocolError('bad_message', message, { cause });
}

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === 'string' && (ERROR_CODES as readonly string[]).includes(value);
}
