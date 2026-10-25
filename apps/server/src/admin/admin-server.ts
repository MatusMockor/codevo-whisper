import { chmod, lstat, mkdir, unlink } from 'node:fs/promises';
import { createServer, type Server, type Socket } from 'node:net';
import { dirname } from 'node:path';
import type { AdminCommands } from './admin-commands';
import { parseAdminCommand, type AdminCommand } from './admin-protocol';
import { LineChannel } from './line-channel';

export type AdminServer = { close(): Promise<void> };

async function preparePrivateDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const info = await lstat(dir);
  if (!info.isDirectory()) {
    throw new Error(`admin socket directory ${dir} is not a directory`);
  }
  if (info.uid !== process.getuid?.()) {
    throw new Error(`admin socket directory ${dir} must be owned by the gateway user (uid ${process.getuid?.() ?? '?'})`);
  }
  if ((info.mode & 0o077) !== 0) {
    throw new Error(`admin socket directory ${dir} must not be accessible by group or others (chmod 700)`);
  }
}

async function listenPrivately(server: Server, path: string): Promise<void> {
  const previous = process.umask(0o177);
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(path, () => resolve());
    });
  } finally {
    process.umask(previous);
  }
}

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
  await preparePrivateDir(dirname(path));
  await removeStaleSocket(path);
  const sockets = new Set<Socket>();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    serve(commands, new LineChannel(socket)).catch(() => socket.destroy());
  });
  await listenPrivately(server, path);
  await chmod(path, 0o600);
  return {
    close: async () => {
      sockets.forEach((socket) => socket.destroy());
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await unlink(path).catch(() => undefined);
    },
  };
}
