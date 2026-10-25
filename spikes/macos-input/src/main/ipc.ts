import { ipcMain, shell } from 'electron'
import type { PermissionKind, Settings, SimulateKind } from '../shared/types.js'
import type { App } from './app.js'

const panes: Record<PermissionKind, string> = {
  listen: 'x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent',
  post: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility',
  accessibility: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility',
}

export function registerIpc(app: App): void {
  ipcMain.handle('control:get-status', () => app.status.refresh())
  ipcMain.handle('control:update-settings', (_event, patch: Partial<Settings>) => app.updateSettings(patch))
  ipcMain.handle('control:simulate', (_event, kind: SimulateKind) => app.simulate(kind))
  ipcMain.handle('control:request-permission', async (_event, kind: PermissionKind) => {
    const result = await app.helper.requestPermission(kind)
    app.log.write('permission-requested', { ...result })
    await app.status.refresh()
  })
  ipcMain.handle('control:open-pane', async (_event, kind: PermissionKind) => {
    app.log.write('settings-pane-opened', { kind, url: panes[kind] })
    await shell.openExternal(panes[kind])
  })
  ipcMain.handle('control:overlay-test', () => app.overlayTest())
  ipcMain.handle('control:restart-helper', () => app.restartHelper())
  ipcMain.handle('control:reveal-log', () => shell.showItemInFolder(app.log.path))
  ipcMain.on('overlay:copy', () => void app.session.copyLast())
}
