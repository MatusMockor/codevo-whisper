import { chmod, lstat, mkdir, unlink } from 'node:fs/promises';
import { createServer, type Socket } from 'node:net';
import { dirname } from 'node:path';
import type { AdminCommands } from './admin-commands';
import { parseAdminCommand, type AdminCommand } from './admin-protocol';
import { LineChannel } from './line-channel';

export type AdminServer = { close(): Promise<void> };

async function removeStaleSocket(path: string): Promise<void> {
  const info = await lstat(path).catch(() => null);
  if (info === null) {
    return;
  }
  if (!info.isSocket()) {
    throw new Error(`${path} exists and is not a socket`);
  }
  await unlink(path);
}

function execute(commands: AdminCommands, channel: LineChannel, command: AdminCommand): Promise<object | null> {
  if (command.cmd === 'pair') {
    return commands.pair(channel, command.ttlMs).then(() => null);
  }
  if (command.cmd === 'revoke') {
    return commands.revoke(command.deviceId);
  }
  if (command.cmd === 'rotate-key') {
    return commands.rotateKey();
  }
  if (command.cmd === 'status') {
    return commands.status();
  }
  return commands.devices();
}

async function serve(commands: AdminCommands, channel: LineChannel): Promise<void> {
  for (let line = await channel.nextLine(); line !== null; line = await channel.nextLine()) {
    const parsed = parseAdminCommand(line);
    if (!parsed.ok) {
      channel.send({ error: parsed.error });
      continue;
    }
    const reply = await execute(commands, channel, parsed.command).catch((error: unknown) => ({
      error: error instanceof Error ? error.message : 'command failed',
    }));
    if (reply !== null) {
      channel.send(reply);
    }
  }
}

export async function startAdminServer(path: string, commands: AdminCommands): Promise<AdminServer> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await removeStaleSocket(path);
  const sockets = new Set<Socket>();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    void serve(commands, new LineChannel(socket));
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(path, () => resolve());
  });
  await chmod(path, 0o600);
  return {
    close: async () => {
      sockets.forEach((socket) => socket.destroy());
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await unlink(path).catch(() => undefined);
    },
  };
}
