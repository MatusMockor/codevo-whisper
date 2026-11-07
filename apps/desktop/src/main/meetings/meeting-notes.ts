import { formatClock, MEETING_DATE, turnLine, type Meeting, type NotesFailure } from '../../shared/meetings';
import { LlmError, type Complete } from '../ai/llm-client';
import { notesMessages } from '../ai/prompts';
import type { Logger } from '../logging/logger';
import type { MeetingStore } from './meeting-store';

export type MeetingNotesDeps = {
  store: Pick<MeetingStore, 'get' | 'meeting' | 'update' | 'writeNotes'>;
  provider: () => Promise<Complete | null>;
  logger: Logger;
  timeoutMs?: number;
};

const NOTES_TIMEOUT_MS = 300_000;
const MAX_TRANSCRIPT_CHARS = 200_000;
const NOT_READY = 'Poznámky sa dajú vytvoriť len z hotového prepisu.';

function transcript({ title, startedAt, durationMs, turns }: Meeting): string {
  const speakers = [...new Set(turns.map((turn) => turn.speaker))];
  return [`Title: ${title}`, `Date: ${MEETING_DATE.format(startedAt)}`, `Duration: ${formatClock(durationMs)}`, `Speakers: ${speakers.join(', ')}`, '', 'Transcript:', ...turns.map(turnLine)].join('\n');
}

export class MeetingNotes {
  private readonly running = new Map<string, Promise<void>>();
  private readonly controller = new AbortController();

  constructor(private readonly deps: MeetingNotesDeps) {}

  isBusy(): boolean {
    return this.running.size > 0;
  }

  isGenerating(id: string): boolean {
    return this.running.has(id);
  }

  async abort(): Promise<void> {
    this.controller.abort();
    await Promise.all(this.running.values());
  }

  generate(id: string): Promise<void> {
    const current = this.running.get(id);
    if (current !== undefined) return current;
    if (this.deps.store.get(id)?.phase.kind !== 'ready' || this.controller.signal.aborted) throw new Error(NOT_READY);
    const run = this.run(id).finally(() => this.running.delete(id));
    this.running.set(id, run);
    return run;
  }

  private async run(id: string): Promise<void> {
    const { store, logger } = this.deps;
    try {
      await store.update(id, { notesPending: true, notesError: null });
      const notesError = await this.write(id).catch((error: unknown): NotesFailure | null => {
        if (this.controller.signal.aborted) return null;
        if (error instanceof LlmError) return error.reason;
        logger.error(`Notes of meeting ${id} could not be created`, error);
        return 'unexpected';
      });
      if (notesError !== null) logger.warn(`Notes of meeting ${id} were not created`, { reason: notesError });
      await store.update(id, { notesPending: false, notesError });
    } catch (error) {
      logger.error(`The notes state of meeting ${id} could not be saved`, error);
    }
  }

  private async write(id: string): Promise<NotesFailure | null> {
    const meeting = await this.deps.store.meeting(id);
    if (meeting === null || meeting.turns.length === 0) return 'empty';
    const complete = await this.deps.provider();
    if (complete === null) return 'not-configured';
    const text = transcript(meeting);
    if (text.length > MAX_TRANSCRIPT_CHARS) return 'too-long';
    const notes = await complete(notesMessages(text), { timeoutMs: this.deps.timeoutMs ?? NOTES_TIMEOUT_MS, signal: this.controller.signal });
    if (notes === '') return 'bad-response';
    await this.deps.store.writeNotes(id, notes);
    return null;
  }
}
