import type { HotkeyKey } from '../../shared/types.js'

export interface KeyCodes {
  mac: number
  uiohook: number | null
}

export const keyCodes: Record<HotkeyKey, KeyCodes> = {
  rightOption: { mac: 61, uiohook: 3640 },
  leftOption: { mac: 58, uiohook: 56 },
  fn: { mac: 63, uiohook: null },
  rightCommand: { mac: 54, uiohook: 3676 },
  rightControl: { mac: 62, uiohook: 3613 },
}
