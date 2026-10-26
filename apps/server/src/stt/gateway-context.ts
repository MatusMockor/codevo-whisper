import type { TranscriptionDispatcher } from '@codevo-whisper/audio';
import type { Language } from '@codevo-whisper/protocol';

export type GatewayContext = { language: Language };

export type GatewayDispatcher = TranscriptionDispatcher<GatewayContext>;
