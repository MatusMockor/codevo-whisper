import { createHash, type Hash } from 'node:crypto';
import { createReadStream } from 'node:fs';

export async function hashFile(file: string, hash: Hash = createHash('sha256')): Promise<Hash> {
  for await (const chunk of createReadStream(file)) {
    hash.update(chunk as Buffer);
  }
  return hash;
}
