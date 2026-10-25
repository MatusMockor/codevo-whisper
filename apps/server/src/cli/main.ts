import { loadConfig } from '../config';
import { runCli } from './commands';

const { adminSocket } = loadConfig(process.env);
process.exitCode = await runCli(process.argv.slice(2), { input: process.stdin, output: process.stdout, socketPath: adminSocket });
