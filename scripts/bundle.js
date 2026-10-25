import { build } from 'esbuild';

const entryPoints = Object.fromEntries(
  process.argv.slice(2).map((argument) => {
    const [name, path] = argument.split('=');
    return [name, path];
  }),
);

await build({
  entryPoints,
  outdir: 'dist',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  sourcemap: false,
  legalComments: 'none',
  external: ['bufferutil', 'utf-8-validate'],
  banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" },
});
