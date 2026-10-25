import { access } from 'node:fs/promises';
import { CliTranscriber } from './cli-transcriber';
import { loadSttConfig } from './config';
import { startSttServer } from './server';

const config = loadSttConfig(process.env);
const log = (event: string, fields: Record<string, string | number> = {}): void => {
  process.stdout.write(`${JSON.stringify({ time: new Date().toISOString(), event, ...fields })}\n`);
};

const modelPresent = await access(config.model).then(
  () => true,
  () => false,
);
if (!modelPresent) {
  log('model_missing', { model: config.model, hint: 'docker compose run --rm stt node dist/provision.js' });
  process.exit(1);
}

const transcriber = new CliTranscriber({ binary: config.binary, model: config.model, backend: config.backend, threads: config.threads });
const server = await startSttServer({ transcriber, port: config.port, host: config.host, onError: (status) => log('engine_error', { status }) });
log('listening', { port: config.port, backend: config.backend });

const shutdown = (): void => {
  void server.stop().then(() => process.exit(0));
};
process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
