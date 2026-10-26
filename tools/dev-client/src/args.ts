export type ParsedArgs = { positional: string[]; options: Map<string, string>; flags: Set<string> };

const FLAGS = new Set(['live']);

export function parseArgs(argv: string[]): ParsedArgs {
  const positional: string[] = [];
  const options = new Map<string, string>();
  const flags = new Set<string>();
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index] ?? '';
    if (!argument.startsWith('--')) {
      positional.push(argument);
      continue;
    }
    const name = argument.slice(2);
    if (FLAGS.has(name)) {
      flags.add(name);
      continue;
    }
    options.set(name, argv[index + 1] ?? '');
    index += 1;
  }
  return { positional, options, flags };
}
