import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { performance } from 'node:perf_hooks';

const SAMPLE_RATE = 16000;
const FRAME_SAMPLES = 1600;
const VAD_SUBFRAME = 160;
const MIN_SAMPLES = 320;

type JobKind = 'partial' | 'final';
type CommitReason = 'pause' | 'hard' | 'end';

interface EngineResponse {
  status: number;
  text: string;
}

interface Transcriber {
  transcribe(pcm: Int16Array): Promise<EngineResponse>;
}

interface Job {
  clientId: number;
  kind: JobKind;
  pcm: Int16Array;
  enqueuedAt: number;
}

interface JobResult {
  dropped: boolean;
  dropReason: string;
  status: number;
  text: string;
  enqueuedAt: number;
  startedAt: number;
  doneAt: number;
  serviceMs: number;
  retries503: number;
}

interface Scheduler {
  submit(job: Job): Promise<JobResult>;
}

interface CallRecord {
  run: string;
  clientId: number;
  session: number;
  kind: JobKind;
  reason: string;
  tailSec: number;
  waitMs: number;
  serviceMs: number;
  totalMs: number;
  stalenessMs: number;
  doneAt: number;
  retries503: number;
  dropped: boolean;
  dropReason: string;
  status: number;
  text: string;
}

interface SessionRecord {
  run: string;
  clientId: number;
  session: number;
  durationSec: number;
  endTailSec: number;
  endOfSpeechToFinalMs: number;
  hardCuts: number;
  pauseCommits: number;
  partialsShown: number;
  partialsDropped: number;
  text: string;
}

interface PolicyConfig {
  intervalMs: number;
  targetSec: number;
  hardSec: number;
  overlapSec: number;
  pauseMs: number;
  threshold: number;
}

class HttpTranscriber implements Transcriber {
  private readonly url: string;

  constructor(url: string) {
    this.url = url;
  }

  async transcribe(pcm: Int16Array): Promise<EngineResponse> {
    const body = Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength);
    const response = await fetch(this.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body,
    });
    if (response.status !== 200) {
      await response.arrayBuffer();
      return { status: response.status, text: '' };
    }
    const payload = (await response.json()) as { text: string };
    return { status: 200, text: payload.text };
  }
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));

async function transcribeWithRetry(
  engine: Transcriber,
  job: Job,
  retryOn503: boolean,
): Promise<{ response: EngineResponse; startedAt: number; doneAt: number; retries: number }> {
  let retries = 0;
  while (true) {
    const startedAt = performance.now();
    const response = await engine.transcribe(job.pcm);
    const doneAt = performance.now();
    if (response.status !== 503) return { response, startedAt, doneAt, retries };
    retries += 1;
    if (!retryOn503) return { response, startedAt, doneAt, retries };
    await sleep(25);
  }
}

class DirectScheduler implements Scheduler {
  private readonly engine: Transcriber;
  private readonly tails = new Map<number, Promise<unknown>>();

  constructor(engine: Transcriber) {
    this.engine = engine;
  }

  submit(job: Job): Promise<JobResult> {
    const previous = this.tails.get(job.clientId) ?? Promise.resolve();
    const run = previous.then(() => this.execute(job));
    this.tails.set(job.clientId, run.catch(() => undefined));
    return run;
  }

  private async execute(job: Job): Promise<JobResult> {
    const outcome = await transcribeWithRetry(this.engine, job, job.kind === 'final');
    const dropped = outcome.response.status === 503;
    return {
      dropped,
      dropReason: dropped ? '503' : '',
      status: outcome.response.status,
      text: outcome.response.text,
      enqueuedAt: job.enqueuedAt,
      startedAt: outcome.startedAt,
      doneAt: outcome.doneAt,
      serviceMs: outcome.doneAt - outcome.startedAt,
      retries503: outcome.retries,
    };
  }
}

interface PendingJob {
  job: Job;
  resolve: (result: JobResult) => void;
}

class SharedFairScheduler implements Scheduler {
  private readonly engine: Transcriber;
  private readonly finals: PendingJob[] = [];
  private readonly partials = new Map<number, PendingJob>();
  private lastPartialClient = -1;
  private busy = false;

  constructor(engine: Transcriber) {
    this.engine = engine;
  }

  submit(job: Job): Promise<JobResult> {
    return new Promise((resolve) => {
      this.enqueue({ job, resolve });
      void this.pump();
    });
  }

  private enqueue(pending: PendingJob): void {
    if (pending.job.kind === 'final') {
      this.finals.push(pending);
      return;
    }
    const replaced = this.partials.get(pending.job.clientId);
    this.partials.set(pending.job.clientId, pending);
    if (!replaced) return;
    replaced.resolve(droppedResult(replaced.job, 'replaced'));
  }

  private next(): PendingJob | undefined {
    const final = this.finals.shift();
    if (final) return final;
    const clients = [...this.partials.keys()].sort((a, b) => a - b);
    if (clients.length === 0) return undefined;
    const after = clients.find((id) => id > this.lastPartialClient);
    const chosen = after ?? clients[0];
    const pending = this.partials.get(chosen);
    this.partials.delete(chosen);
    this.lastPartialClient = chosen;
    return pending;
  }

  private async pump(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    while (true) {
      const pending = this.next();
      if (!pending) break;
      const outcome = await transcribeWithRetry(this.engine, pending.job, true);
      pending.resolve({
        dropped: false,
        dropReason: '',
        status: outcome.response.status,
        text: outcome.response.text,
        enqueuedAt: pending.job.enqueuedAt,
        startedAt: outcome.startedAt,
        doneAt: outcome.doneAt,
        serviceMs: outcome.doneAt - outcome.startedAt,
        retries503: outcome.retries,
      });
    }
    this.busy = false;
  }
}

function droppedResult(job: Job, reason: string): JobResult {
  const now = performance.now();
  return {
    dropped: true,
    dropReason: reason,
    status: 0,
    text: '',
    enqueuedAt: job.enqueuedAt,
    startedAt: now,
    doneAt: now,
    serviceMs: 0,
    retries503: 0,
  };
}

function rms(samples: Int16Array, from: number, to: number): number {
  let sum = 0;
  for (let i = from; i < to; i += 1) sum += samples[i] * samples[i];
  return Math.sqrt(sum / Math.max(1, to - from));
}

function normalizeWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 0);
}

function joinWithDedup(previous: string, next: string): string {
  const previousWords = normalizeWords(previous);
  const nextRaw = next.trim().split(/\s+/).filter((word) => word.length > 0);
  const nextWords = nextRaw.map((word) => normalizeWords(word).join(''));
  const maxOverlap = Math.min(8, previousWords.length, nextWords.length);
  for (let k = maxOverlap; k > 0; k -= 1) {
    const suffix = previousWords.slice(previousWords.length - k).join(' ');
    const prefix = nextWords.slice(0, k).join(' ');
    if (suffix !== prefix) continue;
    return `${previous} ${nextRaw.slice(k).join(' ')}`.trim();
  }
  return `${previous} ${next}`.trim();
}

function wordErrorRate(reference: string, hypothesis: string): number {
  const ref = normalizeWords(reference);
  const hyp = normalizeWords(hypothesis);
  let row = Array.from({ length: hyp.length + 1 }, (_, j) => j);
  for (let i = 1; i <= ref.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= hyp.length; j += 1) {
      const cost = ref[i - 1] === hyp[j - 1] ? 0 : 1;
      current.push(Math.min(row[j] + 1, current[j - 1] + 1, row[j - 1] + cost));
    }
    row = current;
  }
  return row[hyp.length] / Math.max(1, ref.length);
}

interface SessionInput {
  run: string;
  clientId: number;
  session: number;
  audio: Int16Array;
  startAt: number;
}

class RollingSession {
  private readonly input: SessionInput;
  private readonly policy: PolicyConfig;
  private readonly scheduler: Scheduler;
  private readonly calls: CallRecord[];
  private available = 0;
  private tailStart = 0;
  private silentSubframes = 0;
  private partialInFlight = false;
  private lastPartialTick = 0;
  private hardCuts = 0;
  private pauseCommits = 0;
  private partialsShown = 0;
  private partialsDropped = 0;
  private readonly finals: Promise<string>[] = [];

  constructor(input: SessionInput, policy: PolicyConfig, scheduler: Scheduler, calls: CallRecord[]) {
    this.input = input;
    this.policy = policy;
    this.scheduler = scheduler;
    this.calls = calls;
  }

  async run(): Promise<SessionRecord> {
    const audio = this.input.audio;
    const frames = Math.ceil(audio.length / FRAME_SAMPLES);
    this.lastPartialTick = this.input.startAt;
    for (let frame = 0; frame < frames; frame += 1) {
      await sleep(this.input.startAt + (frame + 1) * 100 - performance.now());
      this.pushFrame(Math.min(audio.length, (frame + 1) * FRAME_SAMPLES));
    }
    const endOfSpeech = performance.now();
    const endTailSec = (this.available - this.tailStart) / SAMPLE_RATE;
    this.commitFinal(this.available, this.available, 'end');
    const texts = await Promise.all(this.finals);
    const finalDoneAt = performance.now();
    const text = texts.reduce((acc, piece) => joinWithDedup(acc, piece), '');
    return {
      run: this.input.run,
      clientId: this.input.clientId,
      session: this.input.session,
      durationSec: audio.length / SAMPLE_RATE,
      endTailSec,
      endOfSpeechToFinalMs: finalDoneAt - endOfSpeech,
      hardCuts: this.hardCuts,
      pauseCommits: this.pauseCommits,
      partialsShown: this.partialsShown,
      partialsDropped: this.partialsDropped,
      text,
    };
  }

  private pushFrame(until: number): void {
    const audio = this.input.audio;
    for (let start = this.available; start < until; start += VAD_SUBFRAME) {
      const end = Math.min(until, start + VAD_SUBFRAME);
      const quiet = rms(audio, start, end) < this.policy.threshold;
      this.silentSubframes = quiet ? this.silentSubframes + 1 : 0;
    }
    this.available = until;
    this.maybeCommit();
    this.maybePartial();
  }

  private maybeCommit(): void {
    const tailSamples = this.available - this.tailStart;
    if (tailSamples >= this.policy.hardSec * SAMPLE_RATE) {
      this.hardCuts += 1;
      const overlap = Math.round(this.policy.overlapSec * SAMPLE_RATE);
      this.commitFinal(this.available, this.available - overlap, 'hard');
      return;
    }
    if (tailSamples < this.policy.targetSec * SAMPLE_RATE) return;
    const silentMs = this.silentSubframes * 10;
    if (silentMs < this.policy.pauseMs) return;
    this.pauseCommits += 1;
    const cut = this.available - Math.round((this.silentSubframes * VAD_SUBFRAME) / 2);
    this.commitFinal(cut, cut, 'pause');
  }

  private commitFinal(cutAt: number, nextTailStart: number, reason: CommitReason): void {
    const pcm = this.input.audio.subarray(this.tailStart, cutAt);
    this.tailStart = nextTailStart;
    this.silentSubframes = 0;
    if (pcm.length < MIN_SAMPLES) {
      this.finals.push(Promise.resolve(''));
      return;
    }
    const capturedAt = performance.now();
    const job: Job = { clientId: this.input.clientId, kind: 'final', pcm, enqueuedAt: capturedAt };
    const done = this.scheduler.submit(job).then((result) => {
      this.record(job, reason, result, capturedAt);
      return result.text;
    });
    this.finals.push(done);
  }

  private maybePartial(): void {
    const now = performance.now();
    if (now - this.lastPartialTick < this.policy.intervalMs - 1) return;
    this.lastPartialTick = now;
    if (this.partialInFlight) {
      this.partialsDropped += 1;
      this.calls.push(this.skippedRecord());
      return;
    }
    const pcm = this.input.audio.subarray(this.tailStart, this.available);
    if (pcm.length < SAMPLE_RATE / 2) return;
    this.partialInFlight = true;
    const job: Job = { clientId: this.input.clientId, kind: 'partial', pcm, enqueuedAt: now };
    void this.scheduler.submit(job).then((result) => {
      this.partialInFlight = false;
      this.record(job, 'tick', result, now);
      if (result.dropped) {
        this.partialsDropped += 1;
        return;
      }
      this.partialsShown += 1;
    });
  }

  private skippedRecord(): CallRecord {
    return {
      run: this.input.run,
      clientId: this.input.clientId,
      session: this.input.session,
      kind: 'partial',
      reason: 'tick',
      tailSec: (this.available - this.tailStart) / SAMPLE_RATE,
      waitMs: 0,
      serviceMs: 0,
      totalMs: 0,
      stalenessMs: 0,
      doneAt: performance.now(),
      retries503: 0,
      dropped: true,
      dropReason: 'in-flight',
      status: 0,
      text: '',
    };
  }

  private record(job: Job, reason: string, result: JobResult, capturedAt: number): void {
    this.calls.push({
      run: this.input.run,
      clientId: this.input.clientId,
      session: this.input.session,
      kind: job.kind,
      reason,
      tailSec: job.pcm.length / SAMPLE_RATE,
      waitMs: result.startedAt - result.enqueuedAt,
      serviceMs: result.serviceMs,
      totalMs: result.doneAt - result.enqueuedAt,
      stalenessMs: result.doneAt - capturedAt,
      doneAt: result.doneAt,
      retries503: result.retries503,
      dropped: result.dropped,
      dropReason: result.dropReason,
      status: result.status,
      text: result.text,
    });
  }
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
}

function fmt(value: number): string {
  if (Number.isNaN(value)) return '-';
  return String(Math.round(value));
}

function bucketOf(tailSec: number): string {
  const edges: [number, string][] = [
    [2.5, '<=2.5'],
    [7.5, '5'],
    [12.5, '10'],
    [17.5, '15'],
    [22.5, '20'],
    [27.5, '25'],
  ];
  const hit = edges.find(([edge]) => tailSec <= edge);
  if (!hit) return '>27.5';
  return hit[1];
}

const BUCKET_ORDER = ['<=2.5', '5', '10', '15', '20', '25', '>27.5'];

function tailTable(records: CallRecord[], metric: (record: CallRecord) => number, title: string): string {
  const lines = [`${title}`, '| tail s | n | p50 ms | p95 ms | max ms |', '|---|---|---|---|---|'];
  for (const bucket of BUCKET_ORDER) {
    const values = records.filter((record) => bucketOf(record.tailSec) === bucket).map(metric);
    if (values.length === 0) continue;
    lines.push(`| ${bucket} | ${values.length} | ${fmt(percentile(values, 50))} | ${fmt(percentile(values, 95))} | ${fmt(Math.max(...values))} |`);
  }
  return lines.join('\n');
}

function intervalsBetweenPartials(calls: CallRecord[]): number[] {
  const groups = new Map<string, CallRecord[]>();
  for (const call of calls) {
    if (call.kind !== 'partial' || call.dropped) continue;
    const key = `${call.clientId}:${call.session}`;
    groups.set(key, [...(groups.get(key) ?? []), call]);
  }
  const gaps: number[] = [];
  return [...groups.values()].reduce((acc, group) => acc.concat(group.length < 2 ? [] : gapsOf(group)), gaps);
}

function gapsOf(group: CallRecord[]): number[] {
  const order = group.map((call) => call.doneAt).sort((a, b) => a - b);
  return order.slice(1).map((_, i) => order[i + 1] - order[i]);
}

function summarize(label: string, calls: CallRecord[], sessions: SessionRecord[], reference: string | undefined): string {
  const served = calls.filter((call) => !call.dropped);
  const partials = served.filter((call) => call.kind === 'partial');
  const finals = served.filter((call) => call.kind === 'final');
  const all503 = calls.reduce((sum, call) => sum + call.retries503, 0);
  const droppedByReason = calls
    .filter((call) => call.dropped)
    .reduce<Record<string, number>>((acc, call) => ({ ...acc, [call.dropReason]: (acc[call.dropReason] ?? 0) + 1 }), {});
  const eos = sessions.map((session) => session.endOfSpeechToFinalMs);
  const lines = [
    `## ${label}`,
    '',
    `calls served: ${served.length} (partials ${partials.length}, finals ${finals.length}); 503 responses: ${all503}; partial ticks dropped: ${JSON.stringify(droppedByReason)}`,
    '',
    tailTable(served, (record) => record.serviceMs, '### engine service time by tail length (all served calls)'),
    '',
    tailTable(partials, (record) => record.totalMs, '### partial: tick -> text visible (wait + service)'),
    '',
    tailTable(finals, (record) => record.totalMs, '### final: commit -> final text (wait + service)'),
    '',
    `queue wait ms p50/p95/max: partial ${fmt(percentile(partials.map((c) => c.waitMs), 50))}/${fmt(percentile(partials.map((c) => c.waitMs), 95))}/${fmt(Math.max(0, ...partials.map((c) => c.waitMs)))}, final ${fmt(percentile(finals.map((c) => c.waitMs), 50))}/${fmt(percentile(finals.map((c) => c.waitMs), 95))}/${fmt(Math.max(0, ...finals.map((c) => c.waitMs)))}`,
    `partial refresh gap ms p50/p95: ${fmt(percentile(intervalsBetweenPartials(served), 50))}/${fmt(percentile(intervalsBetweenPartials(served), 95))}`,
    `end-of-speech -> final ms (n=${eos.length}) p50/p95/max: ${fmt(percentile(eos, 50))}/${fmt(percentile(eos, 95))}/${fmt(Math.max(...eos))}`,
    '',
    '| client | session | dur s | end tail s | eos->final ms | hard cuts | pause commits | partials shown | partials dropped |',
    '|---|---|---|---|---|---|---|---|---|',
    ...sessions.map(
      (s) =>
        `| ${s.clientId} | ${s.session} | ${s.durationSec.toFixed(1)} | ${s.endTailSec.toFixed(1)} | ${fmt(s.endOfSpeechToFinalMs)} | ${s.hardCuts} | ${s.pauseCommits} | ${s.partialsShown} | ${s.partialsDropped} |`,
    ),
  ];
  if (!reference) return lines.join('\n');
  const full = sessions.filter((s) => s.session === 0);
  const wer = full.map((s) => `client ${s.clientId}: WER ${(wordErrorRate(reference, s.text) * 100).toFixed(1)} %`);
  return [...lines, '', ...wer].join('\n');
}

function parseList(value: string): number[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .map(Number);
}

function sliceSession(audio: Int16Array, index: number, durationSec: number): Int16Array {
  if (durationSec <= 0) return audio;
  const length = Math.min(audio.length, Math.round(durationSec * SAMPLE_RATE));
  const maxStart = audio.length - length;
  const start = maxStart <= 0 ? 0 : Math.round(((index * 7.3) % (maxStart / SAMPLE_RATE)) * SAMPLE_RATE);
  return audio.subarray(start, start + length);
}

async function runSweep(engine: Transcriber, audio: Int16Array, lengths: number[], reps: number, label: string): Promise<CallRecord[]> {
  const calls: CallRecord[] = [];
  for (let rep = 0; rep < reps; rep += 1) {
    for (const lengthSec of lengths) {
      const pcm = sliceSession(audio, rep * lengths.length + lengths.indexOf(lengthSec), lengthSec);
      const job: Job = { clientId: 0, kind: 'final', pcm, enqueuedAt: performance.now() };
      const outcome = await transcribeWithRetry(engine, job, true);
      calls.push({
        run: label,
        clientId: 0,
        session: rep,
        kind: 'final',
        reason: 'sweep',
        tailSec: pcm.length / SAMPLE_RATE,
        waitMs: outcome.startedAt - job.enqueuedAt,
        serviceMs: outcome.doneAt - outcome.startedAt,
        totalMs: outcome.doneAt - job.enqueuedAt,
        stalenessMs: 0,
        doneAt: outcome.doneAt,
        retries503: outcome.retries,
        dropped: false,
        dropReason: '',
        status: outcome.response.status,
        text: outcome.response.text,
      });
    }
  }
  return calls;
}

function sweepTable(calls: CallRecord[], lengths: number[]): string {
  const lines = ['| tail s | n | p50 ms | p95 ms | max ms | RTF p50 |', '|---|---|---|---|---|---|'];
  for (const lengthSec of lengths) {
    const values = calls.filter((call) => Math.abs(call.tailSec - lengthSec) < 0.01).map((call) => call.serviceMs);
    const p50 = percentile(values, 50);
    lines.push(`| ${lengthSec} | ${values.length} | ${fmt(p50)} | ${fmt(percentile(values, 95))} | ${fmt(Math.max(...values))} | ${(p50 / 1000 / lengthSec).toFixed(3)} |`);
  }
  return lines.join('\n');
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      audio: { type: 'string', default: '.data/speech16k.pcm' },
      reference: { type: 'string', default: '.data/text.txt' },
      url: { type: 'string', default: 'http://127.0.0.1:18001/transcribe?language=sk' },
      mode: { type: 'string', default: 'rolling' },
      scheduler: { type: 'string', default: 'shared' },
      clients: { type: 'string', default: '1' },
      offsets: { type: 'string', default: '0' },
      sessions: { type: 'string', default: '0' },
      interval: { type: 'string', default: '1000' },
      target: { type: 'string', default: '15' },
      hard: { type: 'string', default: '25' },
      overlap: { type: 'string', default: '1' },
      pause: { type: 'string', default: '300' },
      threshold: { type: 'string', default: '500' },
      lengths: { type: 'string', default: '1,2,3,5,7.5,10,12.5,15,17.5,20,22.5,25,30' },
      reps: { type: 'string', default: '10' },
      label: { type: 'string', default: 'run' },
      out: { type: 'string', default: '' },
    },
  });
  const raw = readFileSync(values.audio);
  const audio = new Int16Array(raw.buffer, raw.byteOffset, Math.floor(raw.byteLength / 2));
  const reference = readFileSync(values.reference, 'utf8').replace(/\s+/g, ' ').trim();
  const engine = new HttpTranscriber(values.url);
  const out = values.out || `.data/${values.label}.json`;

  if (values.mode === 'sweep') {
    const lengths = parseList(values.lengths);
    const calls = await runSweep(engine, audio, lengths, Number(values.reps), values.label);
    writeFileSync(out, JSON.stringify({ calls }, null, 1));
    console.log(`## ${values.label}\n\n503 responses: ${calls.reduce((s, c) => s + c.retries503, 0)}\n\n${sweepTable(calls, lengths)}`);
    return;
  }

  const policy: PolicyConfig = {
    intervalMs: Number(values.interval),
    targetSec: Number(values.target),
    hardSec: Number(values.hard),
    overlapSec: Number(values.overlap),
    pauseMs: Number(values.pause),
    threshold: Number(values.threshold),
  };
  const scheduler: Scheduler = values.scheduler === 'direct' ? new DirectScheduler(engine) : new SharedFairScheduler(engine);
  const clientCount = Number(values.clients);
  const offsets = parseList(values.offsets);
  const sessionDurations = parseList(values.sessions);
  const calls: CallRecord[] = [];
  const sessions: SessionRecord[] = [];

  const runClient = async (clientId: number): Promise<void> => {
    await sleep(offsets[clientId] ?? 0);
    for (let index = 0; index < sessionDurations.length; index += 1) {
      const session = new RollingSession(
        { run: values.label, clientId, session: index, audio: sliceSession(audio, index + clientId, sessionDurations[index]), startAt: performance.now() },
        policy,
        scheduler,
        calls,
      );
      sessions.push(await session.run());
      await sleep(500);
    }
  };

  await Promise.all(Array.from({ length: clientCount }, (_, clientId) => runClient(clientId)));
  sessions.sort((a, b) => a.clientId - b.clientId || a.session - b.session);
  writeFileSync(out, JSON.stringify({ policy, scheduler: values.scheduler, calls, sessions }, null, 1));
  const fullAudioReference = sessionDurations[0] <= 0 ? reference : undefined;
  console.log(summarize(`${values.label} (${values.scheduler}, clients ${clientCount}, interval ${policy.intervalMs} ms, target ${policy.targetSec} s, hard ${policy.hardSec} s, pause ${policy.pauseMs} ms)`, calls, sessions, fullAudioReference));
  for (const session of sessions.filter((s) => s.session === 0 && fullAudioReference)) console.log(`\nclient ${session.clientId} text: ${session.text}`);
}

await main();
