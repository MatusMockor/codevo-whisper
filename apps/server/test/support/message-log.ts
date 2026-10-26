import type { ServerMessage } from '@codevo-whisper/protocol';
import type { TestSession } from './test-client';
import { waitUntil } from './wait-until';

export class MessageLog {
  readonly messages: ServerMessage[] = [];
  readonly drained: Promise<void>;

  constructor(session: TestSession) {
    this.drained = this.drain(session);
  }

  async waitFor(predicate: (message: ServerMessage) => boolean, timeoutMs = 5_000): Promise<void> {
    await waitUntil(() => this.messages.some(predicate), timeoutMs);
  }

  of(sessionId: string): ServerMessage[] {
    return this.messages.filter((message) => 'sessionId' in message && message.sessionId === sessionId);
  }

  private async drain(session: TestSession): Promise<void> {
    try {
      for (;;) {
        this.messages.push(await session.next());
      }
    } catch {
      return;
    }
  }
}
