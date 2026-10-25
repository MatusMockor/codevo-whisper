import type { FrontmostApp } from '../helper/InputHelper.js'

export type FocusResult = 'same' | 'no-target' | 'app-changed' | 'window-changed'

export function compareFocus(target: FrontmostApp | null, current: FrontmostApp, compareWindow: boolean): FocusResult {
  if (!target) {
    return 'no-target'
  }
  if (target.pid !== current.pid) {
    return 'app-changed'
  }
  if (!compareWindow) {
    return 'same'
  }
  const before = target.window?.windowId
  const after = current.window?.windowId
  if (before === undefined || after === undefined) {
    return 'same'
  }
  return before === after ? 'same' : 'window-changed'
}
