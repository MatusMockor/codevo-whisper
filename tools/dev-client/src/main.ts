import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { ProtocolError } from '@codevo-whisper/protocol';
import { parseArgs } from './args';
import { FileIdentityStore } from './identity-store';
import { pair } from './pair';
import { transcribe } from './transcribe';

const USAGE = 'Použitie: dev-client pair "<token>" --name <názov> | dev-client transcribe <súbor.wav> [--language sk] [--live]';

const print = (line: string): void => {
  process.stdout.write(`${line}\n`);
};

const store = new FileIdentityStore(join(homedir(), '.config', 'codevo-whisper-dev', 'identity.json'));
const { positional, options, flags } = parseArgs(process.argv.slice(2));
const [command, argument] = positional;

async function run(): Promise<number> {
  if (command === 'pair' && argument !== undefined) {
    return pair(store, argument, options.get('name') ?? 'dev-client', print);
  }
  if (command === 'transcribe' && argument !== undefined) {
    const file = resolve(process.env.INIT_CWD ?? process.cwd(), argument);
    return transcribe(store, file, { language: options.get('language') ?? 'sk', live: flags.has('live') }, print);
  }
  print(USAGE);
  return 2;
}

process.exitCode = await run().catch((error: unknown) => {
  if (error instanceof ProtocolError) {
    print(`Chyba: ${error.code}${error.message === error.code ? '' : ` (${error.message})`}`);
    return 1;
  }
  print(`Chyba: ${error instanceof Error ? error.message : String(error)}`);
  return 1;
});
