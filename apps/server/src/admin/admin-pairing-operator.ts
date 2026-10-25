import type { PairingDecision, PairingEvent, PairingOperator, PairingRequest } from '../pairing/pairing-operator';
import { parseDecision } from './admin-protocol';
import type { LineChannel } from './line-channel';

export class AdminPairingOperator implements PairingOperator {
  readonly finished: Promise<void>;
  private finish: () => void = () => undefined;
  private readonly decisions = new AbortController();

  constructor(private readonly channel: LineChannel) {
    this.finished = new Promise((resolve) => {
      this.finish = resolve;
    });
    channel.onClose(() => this.finish());
  }

  async decide(request: PairingRequest): Promise<PairingDecision> {
    this.channel.send({ event: 'request', ...request });
    for (;;) {
      const line = await this.channel.nextLine(this.decisions.signal);
      if (line === null) {
        throw new Error('the admin connection closed before a decision');
      }
      const decision = parseDecision(line);
      if (decision !== null) {
        return decision;
      }
      this.channel.send({ error: 'expected {"decision":"approve"} or {"decision":"reject"}' });
    }
  }

  notify(event: PairingEvent): void {
    this.decisions.abort();
    this.channel.send(event);
    this.finish();
  }

  onDisconnect(listener: () => void): void {
    this.channel.onClose(listener);
  }
}
