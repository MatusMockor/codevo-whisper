import type { Readable, Writable } from 'node:stream';
import { connectAdmin, type AdminConnection } from '../admin/admin-client';
import { asReply, text, type Reply } from './admin-reply';
import { pairCommand } from './pair-command';
import { Prompt } from './prompt';

export type CliIo = { input: Readable; output: Writable; socketPath: string };

type Command = (admin: AdminConnection, io: CliIo, prompt: Prompt, args: string[]) => Promise<number>;

const USAGE = 'Použitie: codevo-whisper <pair|devices|revoke <id>|rotate-key|status>\n';

const LOST_CONNECTION = Symbol('lost connection');

async function request(admin: AdminConnection, command: object): Promise<Reply | typeof LOST_CONNECTION> {
  admin.send(command);
  const value = await admin.next();
  return value === null ? LOST_CONNECTION : asReply(value);
}

function failed(reply: Reply | typeof LOST_CONNECTION, output: Writable): reply is typeof LOST_CONNECTION {
  if (reply === LOST_CONNECTION) {
    output.write('Spojenie so serverom sa prerušilo.\n');
    return true;
  }
  if (reply.error === undefined) {
    return false;
  }
  output.write(`Chyba: ${text(reply, 'error')}\n`);
  return true;
}

const devices: Command = async (admin, io) => {
  const reply = await request(admin, { cmd: 'devices' });
  if (failed(reply, io.output)) {
    return 1;
  }
  const list = Array.isArray(reply.devices) ? reply.devices.map(asReply) : [];
  if (list.length === 0) {
    io.output.write('Žiadne spárované zariadenia.\n');
    return 0;
  }
  list.forEach((device) => {
    io.output.write(`${text(device, 'id')}  ${text(device, 'name')}\n`);
    io.output.write(`  spárované: ${text(device, 'pairedAt')}  naposledy: ${text(device, 'lastSeenAt')}\n`);
    io.output.write(`  odtlačok:  ${text(device, 'fingerprint')}\n`);
  });
  return 0;
};

const revoke: Command = async (admin, io, _prompt, args) => {
  const [deviceId] = args;
  if (deviceId === undefined) {
    io.output.write(USAGE);
    return 2;
  }
  const reply = await request(admin, { cmd: 'revoke', deviceId });
  if (failed(reply, io.output)) {
    return 1;
  }
  if (reply.revoked !== true) {
    io.output.write(`Zariadenie ${deviceId} neexistuje.\n`);
    return 1;
  }
  io.output.write(`Zariadenie ${deviceId} odobraté, zatvorené relácie: ${text(reply, 'closedSessions')}.\n`);
  return 0;
};

const rotateKey: Command = async (admin, io, prompt) => {
  const confirmed = await prompt.confirm('Všetky zariadenia sa budú musieť znova spárovať. Pokračovať? [y/N]');
  if (!confirmed) {
    io.output.write('Zrušené.\n');
    return 1;
  }
  const reply = await request(admin, { cmd: 'rotate-key' });
  if (failed(reply, io.output)) {
    return 1;
  }
  io.output.write(`Kľúč servera zmenený. Nový odtlačok: ${text(reply, 'fingerprint')}\n`);
  return 0;
};

const status: Command = async (admin, io) => {
  const reply = await request(admin, { cmd: 'status' });
  if (failed(reply, io.output)) {
    return 1;
  }
  io.output.write(`Verzia: ${text(reply, 'version')}\n`);
  io.output.write(`Zariadenia: ${text(reply, 'devices')}\n`);
  io.output.write(`Aktívne relácie: ${text(reply, 'activeSessions')}\n`);
  io.output.write(`Fronta: ${text(reply, 'queue')}\n`);
  io.output.write(`STT: ${text(reply, 'stt')}\n`);
  return 0;
};

const COMMANDS: Record<string, Command> = {
  pair: (admin, io, prompt) => pairCommand(admin, io.output, prompt),
  devices,
  revoke,
  'rotate-key': rotateKey,
  status,
};

async function connect(io: CliIo): Promise<AdminConnection | null> {
  try {
    return await connectAdmin(io.socketPath);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    io.output.write(`Nepodarilo sa pripojiť k ${io.socketPath}: ${reason}\n`);
    return null;
  }
}

export async function runCli(args: string[], io: CliIo): Promise<number> {
  const [name, ...rest] = args;
  const command = name === undefined ? undefined : COMMANDS[name];
  if (command === undefined) {
    io.output.write(USAGE);
    return 2;
  }
  const admin = await connect(io);
  if (admin === null) {
    return 1;
  }
  const prompt = new Prompt(io.input, io.output);
  try {
    return await command(admin, io, prompt, rest);
  } finally {
    prompt.close();
    admin.close();
  }
}
