import { describe, expect, it } from 'vitest';
import type { DictationGuard } from '../src/main/updates/dictation-guard';
import { FakeAppUpdater } from '../src/main/updates/fake-app-updater';
import { UpdateService } from '../src/main/updates/update-service';
import type { UpdateMode, UpdatePhase } from '../src/shared/updates';
import { RecordingLogger } from './recording-logger';

class RecordingGuard implements DictationGuard {
  dictating = false;
  suspended = 0;
  released = 0;

  isDictating(): boolean {
    return this.dictating;
  }

  readonly prepared = Promise.withResolvers<void>();
  holdPreparation = false;

  async suspend(): Promise<() => void> {
    this.suspended += 1;
    if (this.holdPreparation) {
      await this.prepared.promise;
    }
    return () => {
      this.released += 1;
    };
  }
}

function harness(mode: UpdateMode = 'in-app', installStallMs = 120_000) {
  const updater = new FakeAppUpdater();
  const guard = new RecordingGuard();
  const logger = new RecordingLogger();
  const service = new UpdateService({ updater, mode, currentVersion: '1.1.0', dictation: guard, logger, installStallMs });
  const phases: UpdatePhase[] = [];
  service.onChange((status) => phases.push(status.phase));
  return { updater, guard, logger, service, phases };
}

async function readyHarness(installStallMs?: number) {
  const parts = harness('in-app', installStallMs);
  parts.updater.latest = '1.2.0';
  await parts.service.check();
  expect(parts.service.status().phase).toEqual({ kind: 'ready', version: '1.2.0' });
  return parts;
}

describe('UpdateService', () => {
  it('starts idle with the current version and mode', () => {
    const { service } = harness('manual');

    expect(service.status()).toEqual({ currentVersion: '1.1.0', mode: 'manual', phase: { kind: 'idle', checked: false } });
  });

  it('reports the newest version after a check without an update', async () => {
    const { service, phases } = harness();

    const status = await service.check();

    expect(status.phase).toEqual({ kind: 'idle', checked: true });
    expect(phases).toEqual([{ kind: 'checking' }, { kind: 'idle', checked: true }]);
  });

  it('downloads a found update with progress until it is ready', async () => {
    const { service, updater, phases } = harness();
    updater.latest = '1.2.0';
    updater.holdDownloads = true;

    const checked = service.check();
    await expect.poll(() => updater.pendingDownloads()).toBe(1);
    updater.reportProgress(49.6);
    updater.reportProgress(50.2);
    updater.completeDownload();
    await checked;

    expect(phases).toEqual([
      { kind: 'checking' },
      { kind: 'downloading', version: '1.2.0', percent: 0 },
      { kind: 'downloading', version: '1.2.0', percent: 50 },
      { kind: 'ready', version: '1.2.0' },
    ]);
    expect(updater.installs).toBe(0);
  });

  it('only reports an available update in manual mode and never downloads it', async () => {
    const { service, updater } = harness('manual');
    updater.latest = '1.2.0';

    const status = await service.check();

    expect(status.phase).toEqual({ kind: 'available', version: '1.2.0' });
    expect(updater.downloads).toBe(0);
    expect(await service.install()).toBe('not-ready');
  });

  it('never contacts the update feed when updates are unsupported', async () => {
    const { service, updater } = harness('unsupported');
    updater.latest = '1.2.0';

    await service.check();
    await service.checkInBackground();

    expect(updater.checks).toBe(0);
    expect(service.status().phase).toEqual({ kind: 'idle', checked: false });
  });

  it('shows a failed check the user asked for and logs it', async () => {
    const { service, updater, logger } = harness();
    updater.checkFails = true;

    const status = await service.check();

    expect(status.phase).toEqual({ kind: 'error', failed: 'check' });
    expect(logger.errors.map((entry) => entry.message)).toEqual(['The update check failed']);
  });

  it('background check failure keeps the previous phase', async () => {
    const { service, updater, logger, phases } = harness('manual');
    updater.latest = '1.2.0';
    await service.check();
    updater.checkFails = true;

    await service.checkInBackground();

    expect(service.status().phase).toEqual({ kind: 'available', version: '1.2.0' });
    expect(phases.at(-1)).toEqual({ kind: 'available', version: '1.2.0' });
    expect(logger.errors.map((entry) => entry.message)).toEqual(['The background update check failed']);
  });

  it('shows a failed download and retries it with the next check', async () => {
    const { service, updater } = harness();
    updater.latest = '1.2.0';
    updater.downloadFails = true;

    expect((await service.check()).phase).toEqual({ kind: 'error', failed: 'download' });

    updater.downloadFails = false;
    expect((await service.check()).phase).toEqual({ kind: 'ready', version: '1.2.0' });
    expect(updater.downloads).toBe(2);
  });

  it('runs one check at a time', async () => {
    const { service, updater } = harness();
    updater.latest = '1.2.0';

    const [first, second] = await Promise.all([service.check(), service.check(), service.checkInBackground()]);

    expect(updater.checks).toBe(1);
    expect(first.phase).toEqual({ kind: 'ready', version: '1.2.0' });
    expect(second.phase).toEqual({ kind: 'ready', version: '1.2.0' });
  });

  it('does not check again while downloading or when the update is ready', async () => {
    const { service, updater } = harness();
    updater.latest = '1.2.0';
    updater.holdDownloads = true;
    const checked = service.check();
    await expect.poll(() => updater.pendingDownloads()).toBe(1);

    const during = await service.check();
    await service.checkInBackground();
    updater.completeDownload();
    await checked;
    await service.checkInBackground();

    expect(during.phase).toEqual({ kind: 'downloading', version: '1.2.0', percent: 0 });
    expect(updater.checks).toBe(1);
    expect(service.status().phase).toEqual({ kind: 'ready', version: '1.2.0' });
  });

  it('refuses to install before an update is ready', async () => {
    const { service, updater } = harness();

    expect(await service.install()).toBe('not-ready');
    updater.latest = '1.2.0';
    updater.holdDownloads = true;
    void service.check();
    await expect.poll(() => updater.pendingDownloads()).toBe(1);
    expect(await service.install()).toBe('not-ready');
    expect(updater.installs).toBe(0);
  });

  it('refuses to install during a dictation', async () => {
    const { service, updater, guard } = await readyHarness();
    guard.dictating = true;

    expect(await service.install()).toBe('dictation-active');
    expect(updater.installs).toBe(0);
    expect(guard.suspended).toBe(0);
    expect(service.status().phase).toEqual({ kind: 'ready', version: '1.2.0' });
  });

  it('suspends dictation and restarts into the update after the confirmation', async () => {
    const { service, updater, guard } = await readyHarness();

    expect(await service.install()).toBe('restarting');

    expect(updater.installs).toBe(1);
    expect(guard.suspended).toBe(1);
    expect(guard.released).toBe(0);
    expect(service.status().phase).toEqual({ kind: 'installing', version: '1.2.0' });
    expect(await service.install()).toBe('not-ready');
    expect(updater.installs).toBe(1);
  });

  it('hands the update to the installer only after dictation and the microphone are settled', async () => {
    const { service, updater, guard } = await readyHarness();
    guard.holdPreparation = true;

    const installing = service.install();
    await expect.poll(() => guard.suspended).toBe(1);
    expect(service.status().phase).toEqual({ kind: 'installing', version: '1.2.0' });
    expect(await service.install()).toBe('not-ready');
    expect(updater.installs).toBe(0);
    guard.prepared.resolve();

    expect(await installing).toBe('restarting');
    expect(updater.installs).toBe(1);
  });

  it('keeps dictation paused and asks for a manual restart when the install neither restarts nor fails', async () => {
    const { service, updater, guard } = await readyHarness(30);

    await service.install();
    await expect.poll(() => service.status().phase).toEqual({ kind: 'stalled', version: '1.2.0' });
    expect(guard.released).toBe(0);

    updater.failInstall('Squirrel gave up');
    await expect.poll(() => service.status().phase).toEqual({ kind: 'error', failed: 'install' });
    expect(guard.released).toBe(1);
  });

  it('install failure resumes dictation and shows the error', async () => {
    const { service, updater, guard, logger } = await readyHarness();
    await service.install();

    updater.failInstall('Code signature did not pass validation');

    await expect.poll(() => service.status().phase).toEqual({ kind: 'error', failed: 'install' });
    expect(guard.released).toBe(1);
    expect(logger.errors.map((entry) => entry.message)).toEqual(['The update could not be installed']);
  });

  it('a check the user asks for while a background check runs reports its failure', async () => {
    const { service, updater, logger } = harness();
    updater.checkFails = true;

    const background = service.checkInBackground();
    const user = await service.check();
    await background;

    expect(user.phase).toEqual({ kind: 'error', failed: 'check' });
    expect(logger.errors.map((entry) => entry.message)).toEqual(['The update check failed']);
  });

  it('a background check without an update does not show the search', async () => {
    const { service, phases } = harness();

    await service.checkInBackground();

    expect(phases).toEqual([{ kind: 'idle', checked: true }]);
  });

  it('a background check shows nothing but the download it starts', async () => {
    const { service, updater, phases } = harness();
    updater.latest = '1.2.0';

    await service.checkInBackground();

    expect(phases).toEqual([
      { kind: 'downloading', version: '1.2.0', percent: 0 },
      { kind: 'downloading', version: '1.2.0', percent: 100 },
      { kind: 'ready', version: '1.2.0' },
    ]);
  });

  it('keeps an available update visible during later background checks', async () => {
    const { service, updater, phases } = harness('manual');
    updater.latest = '1.2.0';
    await service.check();
    phases.length = 0;

    await service.checkInBackground();

    expect(phases).toEqual([{ kind: 'available', version: '1.2.0' }]);
  });

  it('stays silent through repeated offline background checks and only logs them', async () => {
    const { service, updater, logger, phases } = harness();
    updater.checkFails = true;

    await service.checkInBackground();
    await service.checkInBackground();
    await service.checkInBackground();

    expect(phases).toEqual([]);
    expect(service.status().phase).toEqual({ kind: 'idle', checked: false });
    expect(logger.errors.map((entry) => entry.message)).toEqual([
      'The background update check failed',
      'The background update check failed',
      'The background update check failed',
    ]);
  });

  it('keeps a failed download visible when a later background check is offline', async () => {
    const { service, updater, phases } = harness();
    updater.latest = '1.2.0';
    updater.downloadFails = true;
    await service.check();
    updater.checkFails = true;
    phases.length = 0;

    await service.checkInBackground();

    expect(phases).toEqual([]);
    expect(service.status().phase).toEqual({ kind: 'error', failed: 'download' });
  });

  it('shows the search once the user joins a background check', async () => {
    const { service, phases, updater } = harness();

    const background = service.checkInBackground();
    const user = service.check();
    const again = service.check();
    await Promise.all([background, user, again]);

    expect(updater.checks).toBe(1);
    expect(phases).toEqual([{ kind: 'checking' }, { kind: 'idle', checked: true }]);
  });

  it('a background check while another background check runs does not search twice', async () => {
    const { service, updater } = harness();

    await Promise.all([service.checkInBackground(), service.checkInBackground()]);

    expect(updater.checks).toBe(1);
  });

  it('background checks during an install neither search nor change the phase', async () => {
    const { service, updater } = await readyHarness();
    await service.install();

    await service.checkInBackground();

    expect(updater.checks).toBe(1);
    expect(service.status().phase).toEqual({ kind: 'installing', version: '1.2.0' });
  });

  it('stops notifying a removed listener', async () => {
    const { service } = harness();
    const seen: string[] = [];
    const remove = service.onChange((status) => seen.push(status.phase.kind));
    remove();

    await service.check();

    expect(seen).toEqual([]);
  });
});
