import { fileURLToPath } from 'node:url';
export { readRecordedCalls } from '../../../../packages/stt-runner/test/support/fake-cli';
export const FAKE_WORKER = fileURLToPath(new URL('./resident-worker.js', import.meta.url));
