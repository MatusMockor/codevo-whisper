import { app } from 'electron'
import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { App } from './app.js'
import { HelperProcess } from './helper/HelperProcess.js'
import { registerIpc } from './ipc.js'
import { JsonlLog } from './logger.js'
import { runSelfTest } from './selftest/SelfTest.js'
import { defaultSettings, SettingsStore } from './settings.js'

const logPath = join(homedir(), 'Library/Logs/CodevoWhisperSpike/macos-input.jsonl')
const selfTest = process.argv.includes('--selftest')
const hotkeys = !selfTest && !process.argv.includes('--no-hotkeys')

async function boot(): Promise<void> {
  const root = app.getAppPath()
  const log = new JsonlLog(logPath, randomUUID().slice(0, 8))
  const helperBinary = join(root, 'helper/build/codevo-input-helper')
  log.write('app-start', {
    electron: process.versions.electron,
    node: process.versions.node,
    arch: process.arch,
    pid: process.pid,
    execPath: process.execPath,
    appPath: root,
    selfTest,
    hotkeys,
  })
  const helperProcess = new HelperProcess(helperBinary, log)
  await helperProcess.start()
  log.write('helper-ready', { pid: helperProcess.pid, binary: helperBinary })
  const spike = new App({ root, helperBinary }, new SettingsStore(defaultSettings), log, helperProcess)
  registerIpc(spike)
  await spike.start(hotkeys)
  app.on('before-quit', () => log.write('app-quit', {}))
  app.on('will-quit', () => void spike.shutdown())
  if (!selfTest) {
    return
  }
  const passed = await runSelfTest(spike)
  await spike.shutdown()
  app.exit(passed ? 0 : 1)
}

app.on('window-all-closed', () => app.quit())

app.whenReady().then(boot).catch((error: unknown) => {
  console.error(error)
  app.exit(1)
})
