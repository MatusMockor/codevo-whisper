import { execFile as execFileCallback, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';

export type HelperCommand = { kind: 'direct' | 'user-service'; file: string; args: readonly string[] };
export type HelperLaunch = { child: ChildProcessWithoutNullStreams; cleanup: () => Promise<void> };

const execFile = promisify(execFileCallback);
const SESSION_ENVIRONMENT = ['DISPLAY', 'XAUTHORITY', 'WAYLAND_DISPLAY', 'XDG_SESSION_TYPE', 'XDG_SESSION_ID', 'DBUS_SESSION_BUS_ADDRESS', 'AT_SPI_BUS_ADDRESS'];

export function launchHelper(command: HelperCommand): HelperLaunch {
  if (command.kind === 'direct') {
    return { child: spawn(command.file, [...command.args], { stdio: 'pipe' }), cleanup: () => Promise.resolve() };
  }
  const unit = `codevo-input-helper-${process.pid}-${randomUUID()}.service`;
  const environment = SESSION_ENVIRONMENT.filter((name) => process.env[name] !== undefined).map((name) => `--setenv=${name}`);
  const unset = SESSION_ENVIRONMENT.filter((name) => process.env[name] === undefined);
  if (unset.length > 0) environment.push(`--property=UnsetEnvironment=${unset.join(' ')}`);
  const child = spawn('systemd-run', ['--user', '--pipe', '--wait', '--collect', '--quiet', '--no-ask-password', `--unit=${unit}`, '--service-type=exec', ...environment, '--', command.file, ...command.args], { stdio: 'pipe' });
  let cleanup: Promise<void> | null = null;
  const stop = async () => {
    try {
      await execFile('systemctl', ['--user', 'stop', unit], { timeout: 5000 });
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 5) return;
      throw error;
    }
  };
  return { child, cleanup: () => cleanup ??= stop() };
}
