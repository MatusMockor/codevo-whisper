const { app, BrowserWindow } = require('electron')
const { autoUpdater } = require('electron-updater')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const logDir = path.join(os.homedir(), 'Library', 'Logs', 'CodevoWhisperSpike')
const logFile = path.join(logDir, 'update.log')

fs.mkdirSync(logDir, { recursive: true })

const write = (level, parts) => {
  const text = parts.map((part) => (typeof part === 'string' ? part : JSON.stringify(part))).join(' ')
  fs.appendFileSync(logFile, `${new Date().toISOString()} [${process.pid}] [${level}] ${text}\n`)
}

const logger = {
  info: (...parts) => write('info', parts),
  warn: (...parts) => write('warn', parts),
  error: (...parts) => write('error', parts),
  debug: (...parts) => write('debug', parts)
}

const describeRuntime = () => ({
  version: app.getVersion(),
  arch: process.arch,
  translated: app.runningUnderARM64Translation,
  exe: app.getPath('exe')
})

const createWindow = () => {
  const window = new BrowserWindow({ width: 420, height: 200 })
  const runtime = describeRuntime()
  const html = `<body style="font-family:-apple-system;padding:24px"><h2>Codevo Whisper Spike</h2><p>Version ${runtime.version} (${runtime.arch}${runtime.translated ? ', Rosetta' : ''})</p></body>`
  window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
}

autoUpdater.logger = logger
autoUpdater.autoDownload = true
autoUpdater.autoInstallOnAppQuit = false

autoUpdater.on('checking-for-update', () => logger.info('event checking-for-update'))
autoUpdater.on('update-available', (info) => logger.info('event update-available', { version: info.version, files: info.files }))
autoUpdater.on('update-not-available', (info) => logger.info('event update-not-available', { version: info.version }))
autoUpdater.on('download-progress', (progress) => logger.info('event download-progress', { percent: Math.round(progress.percent), transferred: progress.transferred, total: progress.total }))
autoUpdater.on('error', (error) => logger.error('event error', String(error && error.stack ? error.stack : error)))
autoUpdater.on('update-downloaded', (info) => {
  logger.info('event update-downloaded', { version: info.version, downloadedFile: info.downloadedFile })
  setTimeout(() => {
    logger.info('calling quitAndInstall')
    autoUpdater.quitAndInstall(true, true)
  }, 1500)
})

app.whenReady().then(() => {
  logger.info('app ready', describeRuntime())
  createWindow()
  autoUpdater.checkForUpdates().catch((error) => logger.error('checkForUpdates rejected', String(error)))
})

app.on('before-quit', () => logger.info('before-quit', { version: app.getVersion() }))
app.on('window-all-closed', () => app.quit())
