import { startServer } from './app';
import { loadConfig } from './config';
import { streamLogger } from './logging/logger';

const logger = streamLogger((line) => process.stdout.write(line));
const config = loadConfig(process.env);
const server = await startServer(config, { logger });
logger.info('listening', { bind: config.bind, port: server.gateway.port });

const shutdown = (): void => {
  void server.close().then(() => process.exit(0));
};
process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
