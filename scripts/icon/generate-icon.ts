import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { encodePng } from '../../apps/desktop/src/main/tray/png.ts';
import { ICONSET_ENTRIES, rasterizeAppIcon } from './app-icon-raster.ts';

const DEFAULT_OUTPUT = resolve(import.meta.dirname, '..', '..', 'apps', 'desktop', 'build', 'icon.icns');

function writeIconset(dir: string): void {
  mkdirSync(dir, { recursive: true });
  for (const entry of ICONSET_ENTRIES) {
    writeFileSync(join(dir, entry.name), encodePng(entry.pixels, entry.pixels, rasterizeAppIcon(entry.pixels)));
  }
}

function generate(output: string): void {
  const work = mkdtempSync(join(tmpdir(), 'cw-icon-'));
  try {
    const iconset = join(work, 'icon.iconset');
    writeIconset(iconset);
    mkdirSync(dirname(output), { recursive: true });
    execFileSync('iconutil', ['--convert', 'icns', '--output', output, iconset], { stdio: 'inherit' });
    console.log(`wrote ${output}`);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

generate(resolve(process.argv[2] ?? DEFAULT_OUTPUT));
