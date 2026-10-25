import { nextInRotation } from './round-robin';
import type { Dropped, TranscriptionJob } from './transcription-job';

type Lane<T> = {
  finals: T[];
  partial: T | undefined;
  runningPartials: number;
  runningFinals: number;
};

export class FairJobQueue<T extends { job: TranscriptionJob }> {
  private readonly lanes = new Map<string, Lane<T>>();
  private readonly runningIn = new Map<T, Lane<T>>();
  private lastFinalDevice: string | undefined;
  private lastPartialDevice: string | undefined;

  get size(): number {
    return [...this.lanes.values()].reduce((total, lane) => total + lane.finals.length + (lane.partial === undefined ? 0 : 1), 0);
  }

  offer(entry: T): Dropped<T>[] {
    const lane = this.lane(entry.job.deviceId);
    if (entry.job.kind === 'final') {
      return this.offerFinal(lane, entry);
    }
    return this.offerPartial(lane, entry);
  }

  take(): T | undefined {
    return this.takeFinal() ?? this.takePartial();
  }

  complete(entry: T): void {
    const lane = this.runningIn.get(entry);
    this.runningIn.delete(entry);
    if (lane === undefined) {
      return;
    }
    if (entry.job.kind === 'final') {
      lane.runningFinals = Math.max(0, lane.runningFinals - 1);
      return;
    }
    lane.runningPartials = Math.max(0, lane.runningPartials - 1);
  }

  removeDevice(deviceId: string): Dropped<T>[] {
    const lane = this.lanes.get(deviceId);
    this.lanes.delete(deviceId);
    if (lane === undefined) {
      return [];
    }
    const queued = lane.partial === undefined ? lane.finals : [...lane.finals, lane.partial];
    return queued.map((entry) => ({ entry, reason: 'cancelled' }));
  }

  private offerFinal(lane: Lane<T>, entry: T): Dropped<T>[] {
    lane.finals.push(entry);
    const superseded = lane.partial;
    lane.partial = undefined;
    return superseded === undefined ? [] : [{ entry: superseded, reason: 'superseded' }];
  }

  private offerPartial(lane: Lane<T>, entry: T): Dropped<T>[] {
    if (lane.finals.length > 0 || lane.runningFinals > 0) {
      return [{ entry, reason: 'finalizing' }];
    }
    if (lane.runningPartials > 0) {
      return [{ entry, reason: 'partial-in-flight' }];
    }
    const replaced = lane.partial;
    lane.partial = entry;
    return replaced === undefined ? [] : [{ entry: replaced, reason: 'replaced' }];
  }

  private takeFinal(): T | undefined {
    const deviceId = nextInRotation([...this.lanes.keys()], this.lastFinalDevice, (id) => (this.lanes.get(id)?.finals.length ?? 0) > 0);
    const lane = deviceId === undefined ? undefined : this.lanes.get(deviceId);
    const entry = lane?.finals.shift();
    if (lane === undefined || entry === undefined) {
      return undefined;
    }
    this.lastFinalDevice = deviceId;
    lane.runningFinals += 1;
    this.runningIn.set(entry, lane);
    return entry;
  }

  private takePartial(): T | undefined {
    const deviceId = nextInRotation([...this.lanes.keys()], this.lastPartialDevice, (id) => this.lanes.get(id)?.partial !== undefined);
    const lane = deviceId === undefined ? undefined : this.lanes.get(deviceId);
    const entry = lane?.partial;
    if (lane === undefined || entry === undefined) {
      return undefined;
    }
    this.lastPartialDevice = deviceId;
    lane.partial = undefined;
    lane.runningPartials += 1;
    this.runningIn.set(entry, lane);
    return entry;
  }

  private lane(deviceId: string): Lane<T> {
    const existing = this.lanes.get(deviceId);
    if (existing !== undefined) {
      return existing;
    }
    const created: Lane<T> = { finals: [], partial: undefined, runningPartials: 0, runningFinals: 0 };
    this.lanes.set(deviceId, created);
    return created;
  }
}
