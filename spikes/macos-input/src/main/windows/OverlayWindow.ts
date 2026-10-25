import { BrowserWindow, screen } from 'electron'
import type { OverlayState } from '../../shared/types.js'
import type { EventLog } from '../logger.js'
import type { OverlayView } from '../session/DictationSession.js'
import type { OverlayProbe } from '../session/OverlayFocusAudit.js'

export interface OverlayOptions {
  skipTransformProcessType: boolean
}

const size = { width: 560, height: 132 }
const bottomMargin = 28

export class OverlayWindow implements OverlayView, OverlayProbe {
  private window: BrowserWindow
  private state: OverlayState | null = null

  constructor(
    private readonly htmlPath: string,
    private readonly preloadPath: string,
    private readonly log: EventLog,
    private options: OverlayOptions,
  ) {
    this.window = this.create()
  }

  recreate(options: OverlayOptions): void {
    this.options = options
    this.window.destroy()
    this.window = this.create()
    this.log.write('overlay-recreated', { ...options })
  }

  show(state: OverlayState): void {
    this.state = state
    const cursor = screen.getCursorScreenPoint()
    const display = screen.getDisplayNearestPoint(cursor)
    const area = display.workArea
    const bounds = {
      x: Math.round(area.x + (area.width - size.width) / 2),
      y: Math.round(area.y + area.height - size.height - bottomMargin),
      ...size,
    }
    this.window.setBounds(bounds)
    this.window.showInactive()
    this.send()
    this.log.write('overlay-shown', {
      displayId: display.id,
      displayBounds: display.bounds,
      cursor,
      bounds,
      visible: this.window.isVisible(),
      focused: this.window.isFocused(),
      onAllWorkspaces: this.window.isVisibleOnAllWorkspaces(),
      alwaysOnTop: this.window.isAlwaysOnTop(),
      ...this.options,
    })
  }

  update(patch: Partial<OverlayState>): void {
    if (!this.state) {
      return
    }
    this.state = { ...this.state, ...patch }
    this.send()
  }

  hide(): void {
    this.window.hide()
    this.log.write('overlay-hidden', {})
  }

  isVisible(): boolean {
    return this.window.isVisible()
  }

  isFocused(): boolean {
    return this.window.isFocused()
  }

  renderedText(): Promise<string> {
    return this.window.webContents.executeJavaScript('document.body.innerText')
  }

  private create(): BrowserWindow {
    const window = new BrowserWindow({
      type: 'panel',
      ...size,
      show: false,
      frame: false,
      transparent: true,
      focusable: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      hasShadow: false,
      skipTaskbar: true,
      hiddenInMissionControl: true,
      alwaysOnTop: true,
      webPreferences: { preload: this.preloadPath, sandbox: true, contextIsolation: true, backgroundThrottling: false },
    })
    window.setAlwaysOnTop(true, 'screen-saver')
    window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: this.options.skipTransformProcessType })
    window.webContents.on('did-finish-load', () => this.send())
    void window.loadFile(this.htmlPath)
    return window
  }

  private send(): void {
    if (!this.state || this.window.webContents.isLoading()) {
      return
    }
    this.window.webContents.send('overlay:state', this.state)
  }
}
