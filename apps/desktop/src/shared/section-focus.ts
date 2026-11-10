import type { PageId } from './pages';

export type SettingsSection = 'dictation' | 'microphone' | 'insertion' | 'ai';

export type TranscriptionSection = 'engine' | 'server' | 'local-model';

export type SectionId = SettingsSection | TranscriptionSection;

const TRANSCRIPTION_SECTIONS: readonly SectionId[] = Object.freeze(['engine', 'server', 'local-model']);

export function sectionPage(section: SectionId): PageId {
  return TRANSCRIPTION_SECTIONS.includes(section) ? 'transcription' : 'settings';
}
