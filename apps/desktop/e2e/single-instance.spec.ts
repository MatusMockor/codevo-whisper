import { expect, test, type ElectronApplication } from '@playwright/test';
import type { ChildProcess } from 'node:child_process';
import { appWindows } from './app-windows';
import { createUserDataDir, launchApp, ONBOARDED, removeUserDataDir, spawnApp } from './launch-app';

const SECOND_INSTANCE_EXIT_MS = 10_000;

let app: ElectronApplication;
let userDataDir: string;
let second: ChildProcess | null = null;

test.beforeEach(async () => {
  userDataDir = await createUserDataDir(ONBOARDED);
  app = await launchApp(userDataDir);
  await app.firstWindow();
});

test.afterEach(async () => {
  if (second !== null && second.exitCode === null && second.signalCode === null) {
    second.kill('SIGKILL');
  }
  second = null;
  await app.close();
  await removeUserDataDir(userDataDir);
});

function hasMainWindow(): Promise<boolean> {
  return app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().some((window) => !window.isDestroyed() && window.webContents.getURL().endsWith('/renderer/index.html')),
  );
}

async function launchSecondInstanceAndExpectExit(): Promise<void> {
  const child = spawnApp(userDataDir);
  second = child;
  await expect.poll(() => child.exitCode, { timeout: SECOND_INSTANCE_EXIT_MS }).toBe(0);
}

test('a second launch with the same user data exits and leaves the first instance running', async () => {
  await launchSecondInstanceAndExpectExit();

  expect(await app.evaluate(({ app: electronApp }) => electronApp.isReady())).toBe(true);
  expect(await hasMainWindow()).toBe(true);
});

test('a second launch reopens the main window of the first instance after it was closed', async () => {
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()
      .find((window) => window.webContents.getURL().endsWith('/renderer/index.html'))
      ?.close();
  });
  await expect.poll(hasMainWindow).toBe(false);

  await launchSecondInstanceAndExpectExit();
  await expect.poll(hasMainWindow).toBe(true);
  await expect.poll(() => appWindows(app).length).toBe(1);

  await expect(appWindows(app)[0]!.getByRole('tablist', { name: 'Sekcie aplikácie' })).toBeVisible();
});
