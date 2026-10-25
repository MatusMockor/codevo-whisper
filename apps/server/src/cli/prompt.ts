import type { Readable, Writable } from 'node:stream';
import { createInterface, type Interface } from 'node:readline';

export class Prompt {
  private reader: Interface | null = null;
  private iterator: AsyncIterator<string> | null = null;

  constructor(
    private readonly input: Readable,
    private readonly output: Writable,
  ) {}

  async confirm(question: string): Promise<boolean> {
    this.output.write(`${question} `);
    const answer = await this.lines().next();
    return answer.done !== true && answer.value.trim().toLowerCase() === 'y';
  }

  close(): void {
    this.reader?.close();
  }

  private lines(): AsyncIterator<string> {
    if (this.iterator !== null) {
      return this.iterator;
    }
    this.reader = createInterface({ input: this.input, crlfDelay: Infinity, terminal: false });
    this.iterator = this.reader[Symbol.asyncIterator]();
    return this.iterator;
  }
}
