import { ERROR_CODES, type ErrorCode } from './errors';

const BASE = 4000;

export function closeCodeFor(code: ErrorCode): number {
  return BASE + ERROR_CODES.indexOf(code);
}

export function errorCodeForClose(closeCode: number): ErrorCode | null {
  return ERROR_CODES[closeCode - BASE] ?? null;
}
