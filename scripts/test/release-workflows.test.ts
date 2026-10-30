import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { load } from 'js-yaml';
import { describe, expect, it } from 'vitest';

type Step = { uses?: string; with?: Record<string, unknown>; run?: string; if?: string };

type Job = {
  needs?: string | string[];
  if?: string;
  uses?: string;
  with?: Record<string, unknown>;
  secrets?: unknown;
  permissions?: Record<string, string>;
  environment?: unknown;
  steps?: Step[];
  strategy?: { matrix?: { include?: { arch: string }[] } };
};

type Trigger = { inputs?: Record<string, { type?: string; required?: boolean }> } | null;

type Workflow = { on: Record<string, Trigger>; permissions: Record<string, string>; jobs: Record<string, Job> };

const workflowsDir = join(import.meta.dirname, '..', '..', '.github', 'workflows');

const text = (name: string): string => readFileSync(join(workflowsDir, name), 'utf8');

const workflow = (name: string): Workflow => load(text(name)) as Workflow;

const steps = (job: Job | undefined): Step[] => job?.steps ?? [];

const PINNED_ACTION = /^actions\/[a-z-]+@[0-9a-f]{40}$/;

describe.each(['release.yml', 'release-linux.yml'])('%s', (name) => {
  it('pins every action to a commit and keeps the default token read-only', () => {
    const parsed = workflow(name);
    const uses = Object.values(parsed.jobs).flatMap((job) => steps(job).flatMap((step) => (step.uses === undefined ? [] : [step.uses])));

    expect(parsed.permissions).toEqual({ contents: 'read' });
    expect(uses.length).toBeGreaterThan(0);
    expect(uses.filter((action) => !PINNED_ACTION.test(action))).toEqual([]);
  });

  it('never persists checkout credentials', () => {
    const checkouts = Object.values(workflow(name).jobs).flatMap((job) => steps(job).filter((step) => step.uses?.startsWith('actions/checkout@')));

    expect(checkouts.length).toBeGreaterThan(0);
    checkouts.forEach((step) => expect(step.with?.['persist-credentials']).toBe(false));
  });
});

describe('release-linux.yml', () => {
  const parsed = workflow('release-linux.yml');
  const build = parsed.jobs['build-linux'];

  it('can be called by the release workflow and dispatched by hand with a version', () => {
    expect(parsed.on['workflow_call']?.inputs?.['version']).toMatchObject({ type: 'string', required: true });
    expect(parsed.on['workflow_dispatch']?.inputs?.['version']).toMatchObject({ type: 'string', required: true });
    expect(Object.keys(parsed.on).sort()).toEqual(['workflow_call', 'workflow_dispatch']);
  });

  it('always builds both architectures without secrets or the release environment', () => {
    expect(build?.if).toBeUndefined();
    expect(build?.environment).toBeUndefined();
    expect(build?.strategy?.matrix?.include?.map((entry) => entry.arch)).toEqual(['x64', 'arm64']);
    expect(text('release-linux.yml')).not.toContain('secrets.');
  });

  it('verifies the tag commit on tag builds and uploads linux-<arch> artifacts', () => {
    const verify = steps(build).find((step) => step.run === 'scripts/release/verify-build-ref.sh');
    const upload = steps(build).find((step) => step.uses?.startsWith('actions/upload-artifact@'));

    expect(verify?.if).toBe("github.event_name == 'push'");
    expect(upload?.with?.['name']).toBe('linux-${{ matrix.arch }}');
  });
});

describe('release.yml', () => {
  const parsed = workflow('release.yml');
  const buildLinux = parsed.jobs['build-linux'];
  const publish = parsed.jobs['publish'];

  it('builds Linux through the reusable workflow after the checks, without secrets', () => {
    expect(buildLinux?.uses).toBe('./.github/workflows/release-linux.yml');
    expect(buildLinux?.needs).toEqual(['version', 'checks']);
    expect(buildLinux?.with).toEqual({ version: '${{ needs.version.outputs.version }}' });
    expect(buildLinux?.permissions).toEqual({ contents: 'read' });
    expect(buildLinux?.secrets).toBeUndefined();
    expect(buildLinux?.if).toBeUndefined();
  });

  it('publishes only for tag pushes, after both platforms, with mac and Linux artifacts', () => {
    const patterns = steps(publish)
      .filter((step) => step.uses?.startsWith('actions/download-artifact@'))
      .map((step) => step.with?.['pattern']);

    expect(publish?.if).toBe("github.event_name == 'push'");
    expect(publish?.needs).toEqual(['version', 'build-mac', 'build-linux']);
    expect(patterns).toEqual(['mac-*', 'linux-*']);
    expect(steps(publish).map((step) => step.run).filter((run) => run?.startsWith('scripts/release/assemble-'))).toEqual([
      'scripts/release/assemble-mac-feed.sh artifacts feed "$VERSION"',
      'scripts/release/assemble-linux-feed.sh artifacts feed "$VERSION"',
    ]);
  });
});
