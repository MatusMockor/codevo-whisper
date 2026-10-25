import { access } from 'node:fs/promises';
import { loadSttConfig } from './config';
import { createTranscriber } from './create-transcriber';
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

const transcriber = createTranscriber(config);
const server = await startSttServer({ transcriber, port: config.port, host: config.host, onError: (status) => log('engine_error', { status }) });
log('listening', { port: config.port, backend: config.backend, engine: config.engine });
void transcriber.warmUp().then(
  () => log('engine_ready', { engine: config.engine }),
  () => log('engine_warmup_failed', { engine: config.engine }),
);

const shutdown = (): void => {
  void server
    .stop()
    .then(() => transcriber.close())
    .then(() => process.exit(0));
};
process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
