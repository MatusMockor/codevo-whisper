import type { LanguageIdentifier } from '@codevo-whisper/language-routing';
import type { EngineComponent } from './engine-component';

export interface LanguageIdRunner extends LanguageIdentifier, EngineComponent {}
