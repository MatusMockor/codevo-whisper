import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const DESKTOP = join(import.meta.dirname, '..');
const BUILDER_CONFIG = readFileSync(join(DESKTOP, 'electron-builder.yml'), 'utf8');

function mainSources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? mainSources(path) : [path];
  });
}

function dynamicFakeImports(): string[] {
  const names = mainSources(join(DESKTOP, 'src', 'main')).flatMap((file) =>
    [...readFileSync(file, 'utf8').matchAll(/import\('[./a-z-]*\/(fake-[a-z-]+)'\)/g)].map((match) => match[1] ?? ''),
  );
  return [...new Set(names)].sort();
}

describe('electron-builder.yml', () => {
  it('keeps every e2e-only fake loaded by dynamic import out of the package', () => {
    const fakes = dynamicFakeImports();

    expect(fakes).toEqual(['fake-app-updater', 'fake-input-helper']);
    for (const fake of fakes) {
      expect(BUILDER_CONFIG).toContain(`- '!out/main/${fake}-*.js'`);
    }
  });

  it('publishes to the public GitHub repository the updater reads', () => {
    expect(BUILDER_CONFIG).toMatch(/publish:\n {2}provider: github\n {2}owner: MatusMockor\n {2}repo: codevo-whisper\n/);
  });
});
