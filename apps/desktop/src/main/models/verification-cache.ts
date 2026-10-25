import type { BigIntStats } from 'node:fs';
import type { ModelVerification } from '../engines/active-model';

type Stamp = { size: bigint; mtimeNs: bigint; ino: bigint; result: ModelVerification };

export class VerificationCache {
  private readonly stamps = new Map<string, Stamp>();

  lookup(id: string, info: BigIntStats): ModelVerification | null {
    const stamp = this.stamps.get(id);
    if (stamp === undefined || stamp.size !== info.size || stamp.mtimeNs !== info.mtimeNs || stamp.ino !== info.ino) {
      return null;
    }
    return stamp.result;
  }

  remember(id: string, info: BigIntStats, result: ModelVerification): void {
    this.stamps.set(id, { size: info.size, mtimeNs: info.mtimeNs, ino: info.ino, result });
  }

  forget(id: string): void {
    this.stamps.delete(id);
  }
}
