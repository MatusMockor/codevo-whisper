import { parsePairingToken } from '@codevo-whisper/protocol';

export type ScanState =
  | { kind: 'idle' }
  | { kind: 'scanning' }
  | { kind: 'result' }
  | { kind: 'error'; message: string; settings: boolean };

export const MAX_PAIRING_TOKEN_LENGTH = 16_384;

export interface PairingScanNative {
  scan(): Promise<unknown>;
  cancel(): void;
}

export class PairingScanner {
  state: ScanState = { kind: 'idle' };

  constructor(
    private readonly native: PairingScanNative,
    private readonly changed: (state: ScanState) => void,
    private readonly accepted: (token: string) => void,
  ) {}

  private update(state: ScanState): void {
    this.state = state;
    this.changed(state);
  }

  async start(busy: boolean): Promise<void> {
    const current = this.state;
    if (busy || current.kind === 'scanning') return;
    const scanning = { kind: 'scanning' } satisfies ScanState;
    this.update(scanning);
    try {
      const result = await this.native.scan();
      if (this.state !== scanning) return;
      if (typeof result !== 'object' || result === null || !('kind' in result)) throw new Error();
      if (result.kind === 'cancelled') {
        this.update({ kind: 'idle' });
        return;
      }
      if (result.kind === 'result') {
        try {
          if (!('value' in result) || typeof result.value !== 'string' || result.value.length > MAX_PAIRING_TOKEN_LENGTH) {
            throw new Error();
          }
          parsePairingToken(result.value);
          this.accepted(result.value.trim());
          this.update({ kind: 'result' });
        } catch {
          this.update({ kind: 'error', message: 'This is not a valid Codevo pairing QR. Try Scan QR again or paste a cw1 token.', settings: false });
        }
        return;
      }
      if (result.kind === 'error' && 'reason' in result && result.reason === 'permission') {
        this.update({ kind: 'error', message: 'Camera access is required to scan. Allow Camera in app settings, or paste the token.', settings: true });
        return;
      }
      throw new Error();
    } catch {
      if (this.state === scanning) {
        this.update({ kind: 'error', message: 'QR scanner is unavailable. Try again or paste the pairing token.', settings: false });
      }
    }
  }

  cancel(): void {
    if (this.state.kind !== 'scanning') return;
    this.update({ kind: 'idle' });
    this.native.cancel();
  }

  clear(): void {
    if (this.state.kind !== 'scanning') this.update({ kind: 'idle' });
  }
}
