import { statfs } from 'node:fs/promises';

export interface DiskSpace {
  availableBytes(directory: string): Promise<number>;
}

export class StatfsDiskSpace implements DiskSpace {
  async availableBytes(directory: string): Promise<number> {
    const stats = await statfs(directory);
    return stats.bavail * stats.bsize;
  }
}
