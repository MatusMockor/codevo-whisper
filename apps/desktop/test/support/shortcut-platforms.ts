export const SHORTCUT_PLATFORMS = [
  { name: 'macOS', platform: 'darwin', keycodes: { a: 0, j: 38, p: 35, control: 59 } },
  { name: 'Linux X11', platform: 'linux', keycodes: { a: 0x10000 + 38, j: 0x10000 + 44, p: 0x10000 + 33, control: 0x10000 + 37 } },
  { name: 'Linux Wayland', platform: 'linux', keycodes: { a: 0x20000 + 30, j: 0x20000 + 36, p: 0x20000 + 25, control: 0x20000 + 29 } },
] as const;
