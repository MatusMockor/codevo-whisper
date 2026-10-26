import type { DictationMode } from './settings';

export type AppStatus = { hotkeyLabel: string | null; mode: DictationMode; modelReady: boolean; pairingNeeded: boolean; serverRepairNeeded: boolean; permissionsOk: boolean; paused: boolean };
