import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const RENDERER = join(import.meta.dirname, '..', 'src', 'renderer');

const THEMED_PROPERTY = /(^|[\s,])(color|background(-color)?|border(-[a-z]+)?-color|border|box-shadow|outline(-color)?|fill|stroke|all)(\s|,|$)/;

const OVERLAY_VARIABLES = new Set(['f-ui', 'f-mono', 'radius-pill', 'lvl']);

function source(...path: string[]): string {
  return readFileSync(join(RENDERER, ...path), 'utf8');
}

function darkBlock(tokens: string): string {
  const start = tokens.indexOf('@media (prefers-color-scheme: dark)');
  expect(start).toBeGreaterThan(-1);
  return tokens.slice(start);
}

function transitions(css: string): string[] {
  return [...css.matchAll(/transition:\s*([^;]+);/g)].map((match) => match[1] ?? '').filter((value) => value.trim() !== 'none');
}

function variables(css: string): string[] {
  return [...new Set([...css.matchAll(/var\(--([a-z0-9-]+)/g)].map((match) => match[1] ?? ''))];
}

function tsxFiles(directory: string): string[] {
  return readdirSync(join(RENDERER, directory))
    .filter((name) => name.endsWith('.tsx'))
    .map((name) => join(directory, name));
}

function unstyledTags(path: string, tags: ReadonlySet<string>): string[] {
  const file = ts.createSourceFile(path, source(path), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && tags.has(node.tagName.getText(file))) {
      const styled = node.attributes.properties.some((attribute) => ts.isJsxAttribute(attribute) && attribute.name.getText(file) === 'className');
      if (!styled) {
        found.push(`${path}:${file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1} <${node.tagName.getText(file)}>`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

describe('theme-aware styles', () => {
  it('lets native controls follow the light and the dark theme', () => {
    const tokens = source('styles', 'tokens.css');
    expect(tokens.slice(0, tokens.indexOf('@media'))).toContain('color-scheme: light;');
    expect(darkBlock(tokens)).toContain('color-scheme: dark;');
  });

  it('never animates theme colours in the onboarding, so a theme switch never leaves light surfaces behind dark-theme text', () => {
    expect(transitions(source('styles', 'onboarding.css')).filter((value) => THEMED_PROPERTY.test(value))).toEqual([]);
  });

  it('gives every onboarding and overlay button and textarea an app style instead of the browser default', () => {
    const files = [...tsxFiles('onboarding'), ...tsxFiles('overlay'), join('pages', 'Onboarding.tsx')];
    expect(files.flatMap((path) => unstyledTags(path, new Set(['button', 'textarea'])))).toEqual([]);
  });

  it('keeps the overlay dark in both themes by using only its own fixed tokens', () => {
    const overlay = source('overlay', 'overlay.css');
    expect(overlay).toContain('color-scheme: dark;');
    expect(variables(overlay).filter((name) => !name.startsWith('ov-') && !OVERLAY_VARIABLES.has(name))).toEqual([]);
    expect([...darkBlock(source('styles', 'tokens.css')).matchAll(/--ov-[a-z0-9-]+:/g)]).toEqual([]);
  });
});
