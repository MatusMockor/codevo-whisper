import type { Writable } from 'node:stream';
import { toString as qrToString } from 'qrcode';
import type { AdminConnection } from '../admin/admin-client';
import { asReply, text, type Reply } from './admin-reply';
import type { Prompt } from './prompt';

const OUTCOMES: Record<string, { message: (reply: Reply) => string; exitCode: number }> = {
  paired: { message: (reply) => `Zariadenie spárované (id ${text(reply, 'deviceId')}).`, exitCode: 0 },
  rejected: { message: () => 'Párovanie zamietnuté.', exitCode: 1 },
  expired: { message: () => 'Párovacie okno vypršalo.', exitCode: 1 },
  abandoned: { message: () => 'Zariadenie sa odpojilo pred rozhodnutím.', exitCode: 1 },
  failed: { message: () => 'Párovanie zlyhalo (príliš veľa neúspešných pokusov alebo chyba registra zariadení), párovacie okno je zatvorené.', exitCode: 1 },
};

async function printToken(output: Writable, reply: Reply): Promise<void> {
  const token = text(reply, 'token');
  const expiresAt = new Date(Number(reply.expiresAt)).toISOString();
  output.write(`Párovací token (platný do ${expiresAt}):\n\n${token}\n\n`);
  output.write(await qrToString(token, { type: 'terminal', small: true }));
  output.write('\nČakám na zariadenie...\n');
}

async function answerRequest(admin: AdminConnection, output: Writable, prompt: Prompt, reply: Reply): Promise<void> {
  output.write(`\nZariadenie: ${text(reply, 'deviceName')}\n`);
  output.write(`Odtlačok zariadenia: ${text(reply, 'deviceFingerprint')}\n`);
  output.write(`Odtlačok spojenia:   ${text(reply, 'handshakeFingerprint')}\n`);
  output.write('Porovnajte odtlačok spojenia s tým, ktorý ukazuje aplikácia.\n');
  const approved = await prompt.confirm('Spárovať toto zariadenie? [y/N]');
  admin.send({ decision: approved ? 'approve' : 'reject' });
}

export async function pairCommand(admin: AdminConnection, output: Writable, prompt: Prompt): Promise<number> {
  admin.send({ cmd: 'pair' });
  for (let value = await admin.next(); value !== null; value = await admin.next()) {
    const reply = asReply(value);
    if (reply.event === 'token') {
      await printToken(output, reply);
      continue;
    }
    if (reply.event === 'request') {
      await answerRequest(admin, output, prompt, reply);
      continue;
    }
    const outcome = OUTCOMES[text(reply, 'event')];
    if (outcome !== undefined) {
      output.write(`${outcome.message(reply)}\n`);
      return outcome.exitCode;
    }
    output.write(`Chyba: ${text(reply, 'error')}\n`);
    return 1;
  }
  output.write('Spojenie so serverom sa prerušilo.\n');
  return 1;
}
