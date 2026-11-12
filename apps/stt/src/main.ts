import { loadSttConfig } from './config';
import { createEngine } from './create-engine';
import { missingFiles } from './model-files';
import { startSttServer } from './server';

const config = loadSttConfig(process.env);
const log = (event: string, fields: Record<string, string | number> = {}): void => {
  process.stdout.write(`${JSON.stringify({ time: new Date().toISOString(), event, ...fields })}\n`);
};
const PROVISION_HINT = 'docker compose --profile provision run --rm stt-provision';

if ((await missingFiles([config.model])).length > 0) {
  log('model_missing', { model: config.model, hint: PROVISION_HINT });
  process.exit(1);
}

const missingLanguageModels = await missingFiles([config.conditionedModel, config.lidModel]);
if (missingLanguageModels.length > 0) {
  log('language_models_missing', { models: missingLanguageModels.join(','), hint: PROVISION_HINT });
}

const engine = createEngine(config, { routing: missingLanguageModels.length === 0 });
const server = await startSttServer({
  transcriber: engine.transcriber,
  router: engine.router,
  models: engine.models,
  port: config.port,
  host: config.host,
  onError: (status) => log('engine_error', { status }),
});
log('listening', { port: config.port, backend: config.backend, engine: config.engine });
void engine.transcriber.warmUp().then(
  () => log('engine_ready', { engine: config.engine }),
  () => log('engine_warmup_failed', { engine: config.engine }),
);
if (missingLanguageModels.length === 0) {
  const onRetry = (retryInMs: number): void => log('language_models_warmup_failed', { engine: config.engine, retryInMs });
  void engine.warmUpLanguageModels(onRetry).then((ready) => {
    if (!ready) {
      return;
    }
    log('language_models_ready', { engine: config.engine, lidBackend: config.lidBackend });
  });
}

const shutdown = (): void => {
  void server
    .stop()
    .then(() => engine.close())
    .then(() => process.exit(0));
};
process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
