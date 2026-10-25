import { stat } from 'node:fs/promises';
import type { ActiveModel } from '../src/main/engines/active-model';

export class FileActiveModel implements ActiveModel {
  constructor(private readonly path: string | null) {}

  activeModelPath(): Promise<string | null> {
    return Promise.resolve(this.path);
  }

  async verifyActive(): Promise<'ok' | 'missing' | 'broken'> {
    if (this.path === null) {
      return 'missing';
    }
    const info = await stat(this.path).catch(() => null);
    if (info === null) {
      return 'missing';
    }
    return info.size > 0 ? 'ok' : 'broken';
  }
}
