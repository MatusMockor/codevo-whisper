import type { HotkeySetting } from './settings';

export type HotkeyRecordResult = NonNullable<HotkeySetting> | 'unsupported' | 'timeout';
