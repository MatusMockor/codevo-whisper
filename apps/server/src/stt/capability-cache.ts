import type { DictationLanguage } from '@codevo-whisper/protocol';
import { NO_CAPABILITIES, type SttCapabilities, type SttCapabilityReport } from './stt-capabilities';

export interface CapabilityLookup {
  current(): SttCapabilityReport;
  supports(languages: readonly DictationLanguage[]): boolean;
}

export interface RefreshableCapabilities extends CapabilityLookup {
  refresh(): Promise<void>;
}

export class SttCapabilityCache implements RefreshableCapabilities {
  private report: SttCapabilityReport = NO_CAPABILITIES;
  private pending: Promise<void> | null = null;

  constructor(private readonly source: SttCapabilities) {}

  current(): SttCapabilityReport {
    return this.report;
  }

  supports(languages: readonly DictationLanguage[]): boolean {
    return languages.length > 0 && languages.every((language) => this.report.languages.includes(language));
  }

  refresh(): Promise<void> {
    this.pending ??= this.load().finally(() => {
      this.pending = null;
    });
    return this.pending;
  }

  private async load(): Promise<void> {
    this.report = await this.source.capabilities().catch(() => NO_CAPABILITIES);
  }
}

export function refreshEvery(capabilities: RefreshableCapabilities, intervalMs: number): () => Promise<void> {
  let pending = capabilities.refresh();
  const timer = setInterval(() => { pending = capabilities.refresh(); }, intervalMs);
  timer.unref();
  return async () => {
    clearInterval(timer);
    await pending;
  };
}
