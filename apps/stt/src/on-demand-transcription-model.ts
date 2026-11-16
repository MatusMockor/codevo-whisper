import type { LoadableTranscriber } from './loadable-transcriber';
import type { ModelInventory } from './model-inventory';
import type { ModelJobs } from './model-jobs';
import type { ResidencyLimit, ResidentCandidate } from './residency-limit';
import { SingleFlightWarmUp } from './single-flight-warm-up';
import type { TranscriptionJob } from './transcription-job';
import type { ManagedModel } from './transcription-model';
import type { ValidQuery } from './transcribe-query';

export type OnDemandParts = { transcriber: LoadableTranscriber; jobs: ModelJobs; inventory: ModelInventory; residency: ResidencyLimit };

export class OnDemandTranscriptionModel implements ManagedModel, ResidentCandidate {
  private readonly warmUp: SingleFlightWarmUp;
  private calls = 0;
  private preparations = 0;
  private removal = false;
  private usedAt = 0;

  constructor(
    readonly id: string,
    readonly name: string,
    private readonly parts: OnDemandParts,
  ) {
    this.warmUp = new SingleFlightWarmUp(parts.transcriber);
    parts.residency.register(this);
  }

  available(): boolean {
    return !this.removal && this.parts.inventory.isInstalled(this.id);
  }

  ready(): boolean {
    return this.parts.transcriber.resident();
  }

  async prepare(): Promise<void> {
    this.assertAvailable();
    this.preparations += 1;
    this.touch();
    try {
      await this.load();
    } finally {
      this.preparations -= 1;
    }
  }

  async use<T>(work: () => Promise<T>): Promise<T> {
    this.calls += 1;
    this.touch();
    try {
      return await work();
    } finally {
      this.calls -= 1;
      void this.parts.residency.trim().catch(() => undefined);
    }
  }

  jobFor(query: ValidQuery): TranscriptionJob | null {
    return this.parts.jobs.jobFor(query);
  }

  resident(): boolean {
    return this.ready();
  }

  loading(): boolean {
    return this.preparations > 0 || this.warmUp.running();
  }

  inUse(): boolean {
    return this.calls > 0 || this.loading() || this.removal;
  }

  removing(): boolean {
    return this.removal;
  }

  beginRemoval(): boolean {
    if (this.inUse()) {
      return false;
    }
    this.removal = true;
    return true;
  }

  endRemoval(): void {
    this.removal = false;
  }

  lastUsed(): number {
    return this.usedAt;
  }

  unload(): Promise<void> {
    return this.parts.transcriber.unload();
  }

  private async load(): Promise<void> {
    if (this.ready()) {
      return;
    }
    if (!this.warmUp.running()) {
      await this.parts.residency.makeRoomFor(this);
    }
    this.assertAvailable();
    await this.warmUp.run();
    this.assertAvailable();
    await this.parts.residency.trim(this);
  }

  private touch(): void {
    this.usedAt = this.parts.residency.stamp();
  }

  private assertAvailable(): void {
    if (!this.available()) {
      throw new Error(`model ${this.id} is not available`);
    }
  }
}
