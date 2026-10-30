import { fileURLToPath } from 'node:url';
import { HelperProcess } from '../src/main/helper/helper-process';
import { RecordingLogger } from './recording-logger';

const SCRIPT = fileURLToPath(new URL('./fixtures/protocol-helper.js', import.meta.url));

export function protocolHelper(timeoutMs = 2000, flags: string[] = []): HelperProcess {
  return new HelperProcess({ kind: 'direct', file: process.execPath, args: [SCRIPT, ...flags] }, { logger: new RecordingLogger(), timeoutMs });
}
