export type ParsedArgs = { positional: string[]; options: Map<string, string> };

export function parseArgs(argv: string[]): ParsedArgs {
  const positional: string[] = [];
  const options = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index] ?? '';
    if (!argument.startsWith('--')) {
      positional.push(argument);
      continue;
    }
    options.set(argument.slice(2), argv[index + 1] ?? '');
    index += 1;
  }
  return { positional, options };
}
