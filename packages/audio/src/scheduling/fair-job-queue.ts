import { nextInRotation } from './round-robin';
import type { Dropped, QueueKey } from './transcription-job';

type Lane<T> = {
  finals: T[];
  partials: Map<string, T>;
};

type SessionLoad = {
  queuedFinals: number;
  runningFinals: number;
  runningPartials: number;
  released: boolean;
};

export type QueueStats = { sessions: number; lanes: number };

export class FairJobQueue<T extends { job: QueueKey }> {
  private readonly lanes = new Map<string, Lane<T>>();
  private readonly sessions = new Map<string, SessionLoad>();
  private lastFinalDevice: string | undefined;
  private lastPartialDevice: string | undefined;

  get size(): number {
    return [...this.lanes.values()].reduce((total, lane) => total + lane.finals.length + lane.partials.size, 0);
  }

  stats(): QueueStats {
    return { sessions: this.sessions.size, lanes: this.lanes.size };
  }

  offer(entry: T): Dropped<T>[] {
    const lane = this.lane(entry.job.deviceId);
    const load = this.load(entry.job.sessionId);
    if (entry.job.kind === 'final') {
      return this.offerFinal(lane, load, entry);
    }
    return this.offerPartial(lane, load, entry);
  }

  take(): T | undefined {
    return this.takeFinal() ?? this.takePartial();
  }

  complete(entry: T): void {
    const load = this.sessions.get(entry.job.sessionId);
    if (load === undefined) {
      return;
    }
    if (entry.job.kind === 'final') {
      load.runningFinals = Math.max(0, load.runningFinals - 1);
    }
    if (entry.job.kind === 'partial') {
      load.runningPartials = Math.max(0, load.runningPartials - 1);
    }
    this.forgetIfIdle(entry.job.sessionId, load);
  }

  releaseSession(sessionId: string): void {
    const load = this.sessions.get(sessionId);
    if (load === undefined) {
      return;
    }
    load.released = true;
    this.forgetIfIdle(sessionId, load);
  }

  removeSession(sessionId: string): Dropped<T>[] {
    this.sessions.delete(sessionId);
    return this.extractQueued(sessionId);
  }

  removeQueued(sessionId: string): Dropped<T>[] {
    const dropped = this.extractQueued(sessionId);
    const load = this.sessions.get(sessionId);
    if (load !== undefined) {
      load.queuedFinals = 0;
      this.forgetIfIdle(sessionId, load);
    }
    return dropped;
  }

  private extractQueued(sessionId: string): Dropped<T>[] {
    const dropped: T[] = [];
    for (const lane of this.lanes.values()) {
      dropped.push(...lane.finals.filter((entry) => entry.job.sessionId === sessionId));
      lane.finals = lane.finals.filter((entry) => entry.job.sessionId !== sessionId);
      const partial = lane.partials.get(sessionId);
      lane.partials.delete(sessionId);
      dropped.push(...(partial === undefined ? [] : [partial]));
    }
    this.pruneEmptyLanes();
    return dropped.map((entry) => ({ entry, reason: 'cancelled' }));
  }

  private forgetIfIdle(sessionId: string, load: SessionLoad): void {
    const busy = load.queuedFinals + load.runningFinals + load.runningPartials > 0;
    const pendingPartial = [...this.lanes.values()].some((lane) => lane.partials.has(sessionId));
    if (!load.released || busy || pendingPartial) {
      return;
    }
    this.sessions.delete(sessionId);
    this.pruneEmptyLanes();
  }

  private pruneEmptyLanes(): void {
    for (const [deviceId, lane] of this.lanes) {
      if (lane.finals.length === 0 && lane.partials.size === 0) {
        this.lanes.delete(deviceId);
      }
    }
  }

  private offerFinal(lane: Lane<T>, load: SessionLoad, entry: T): Dropped<T>[] {
    lane.finals.push(entry);
    load.queuedFinals += 1;
    const superseded = lane.partials.get(entry.job.sessionId);
    lane.partials.delete(entry.job.sessionId);
    return superseded === undefined ? [] : [{ entry: superseded, reason: 'superseded' }];
  }

  private offerPartial(lane: Lane<T>, load: SessionLoad, entry: T): Dropped<T>[] {
    if (load.queuedFinals > 0 || load.runningFinals > 0) {
      return [{ entry, reason: 'finalizing' }];
    }
    if (load.runningPartials > 0) {
      return [{ entry, reason: 'partial-in-flight' }];
    }
    const replaced = lane.partials.get(entry.job.sessionId);
    lane.partials.set(entry.job.sessionId, entry);
    return replaced === undefined ? [] : [{ entry: replaced, reason: 'replaced' }];
  }

  private takeFinal(): T | undefined {
    const deviceId = nextInRotation([...this.lanes.keys()], this.lastFinalDevice, (id) => (this.lanes.get(id)?.finals.length ?? 0) > 0);
    const entry = deviceId === undefined ? undefined : this.lanes.get(deviceId)?.finals.shift();
    if (entry === undefined) {
      return undefined;
    }
    this.lastFinalDevice = deviceId;
    const load = this.load(entry.job.sessionId);
    load.queuedFinals = Math.max(0, load.queuedFinals - 1);
    load.runningFinals += 1;
    return entry;
  }

  private takePartial(): T | undefined {
    const deviceId = nextInRotation([...this.lanes.keys()], this.lastPartialDevice, (id) => (this.lanes.get(id)?.partials.size ?? 0) > 0);
    const lane = deviceId === undefined ? undefined : this.lanes.get(deviceId);
    const entry = lane?.partials.values().next().value;
    if (lane === undefined || entry === undefined) {
      return undefined;
    }
    this.lastPartialDevice = deviceId;
    lane.partials.delete(entry.job.sessionId);
    this.load(entry.job.sessionId).runningPartials += 1;
    return entry;
  }

  private lane(deviceId: string): Lane<T> {
    const existing = this.lanes.get(deviceId);
    if (existing !== undefined) {
      return existing;
    }
    const created: Lane<T> = { finals: [], partials: new Map() };
    this.lanes.set(deviceId, created);
    return created;
  }

  private load(sessionId: string): SessionLoad {
    const existing = this.sessions.get(sessionId);
    if (existing !== undefined) {
      return existing;
    }
    const created: SessionLoad = { queuedFinals: 0, runningFinals: 0, runningPartials: 0, released: false };
    this.sessions.set(sessionId, created);
    return created;
  }
}
