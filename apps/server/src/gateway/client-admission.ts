import type { IncomingMessage } from 'node:http';
import { isIP } from 'node:net';
import type { PreAuthLimiter } from './pre-auth-limiter';

type Admitted = { ip: string; confirmed: boolean };

export class ClientAdmission {
  private readonly admitted = new WeakMap<IncomingMessage, Admitted>();

  constructor(
    private readonly trustedHeader: string | null,
    private readonly limiter: PreAuthLimiter | null,
  ) {}

  admit(request: IncomingMessage): boolean {
    const entry: Admitted = { ip: this.resolve(request), confirmed: false };
    if (this.limiter !== null && !this.limiter.tryAcquire(entry.ip)) {
      return false;
    }
    this.admitted.set(request, entry);
    request.socket.once('close', () => this.limiter?.release(entry.ip, entry.confirmed));
    return true;
  }

  addressOf(request: IncomingMessage): string {
    return this.admitted.get(request)?.ip ?? this.resolve(request);
  }

  confirm(request: IncomingMessage): void {
    const entry = this.admitted.get(request);
    if (entry === undefined || entry.confirmed) {
      return;
    }
    entry.confirmed = true;
    this.limiter?.promote(entry.ip);
  }

  private resolve(request: IncomingMessage): string {
    const socketAddress = request.socket.remoteAddress ?? 'unknown';
    if (this.trustedHeader === null) {
      return socketAddress;
    }
    const raw = request.headers[this.trustedHeader];
    const value = (Array.isArray(raw) ? raw[0] : raw)?.split(',')[0]?.trim() ?? '';
    return isIP(value) === 0 ? socketAddress : value;
  }
}
