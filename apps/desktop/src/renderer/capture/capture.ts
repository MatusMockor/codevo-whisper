import type { CaptureCommand, CaptureMode, CaptureReply, CaptureStartResult, RawAudioDevice } from '../../shared/capture-contract';
import { MicrophoneSession } from './microphone-session';

const bridge = window.codevoCapture;

let session: MicrophoneSession | null = null;
let queue: Promise<unknown> = Promise.resolve();

async function listDevices(): Promise<RawAudioDevice[]> {
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices.filter((device) => device.kind === 'audioinput').map((device) => ({ deviceId: device.deviceId, label: device.label }));
}

async function stop(): Promise<null> {
  const current = session;
  session = null;
  if (current === null) {
    return null;
  }
  await current.close();
  return null;
}

async function start(deviceId: string | null, mode: CaptureMode): Promise<CaptureStartResult> {
  await stop();
  session = await MicrophoneSession.open(deviceId, mode, {
    frame: (pcm) => {
      bridge.frame(pcm);
    },
    level: (rms) => {
      bridge.level(rms);
    },
  });
  return { label: session.label };
}

function execute(command: CaptureCommand): Promise<unknown> {
  if (command.type === 'list-devices') {
    return listDevices();
  }
  if (command.type === 'start') {
    return start(command.deviceId, command.mode);
  }
  return stop();
}

function enqueue(command: CaptureCommand): Promise<unknown> {
  const run = queue.then(() => execute(command));
  queue = run.catch(() => undefined);
  return run;
}

function failure(id: number, error: unknown): CaptureReply {
  if (error instanceof Error) {
    return { id, ok: false, error: `${error.name}: ${error.message}` };
  }
  return { id, ok: false, error: String(error) };
}

bridge.onCommand((command) => {
  enqueue(command).then(
    (value) => {
      bridge.reply({ id: command.id, ok: true, value });
    },
    (error: unknown) => {
      bridge.reply(failure(command.id, error));
    },
  );
});

navigator.mediaDevices.addEventListener('devicechange', () => {
  void listDevices().then((devices) => {
    bridge.devicesChanged(devices);
  });
});
