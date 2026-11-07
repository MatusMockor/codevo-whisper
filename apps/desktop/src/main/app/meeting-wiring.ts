import { app } from 'electron';
import { join } from 'node:path';
import type { AudioCapture } from '../audio/audio-capture';
import { resolveDevice } from '../audio/device-resolver';
import { localBackend, type LocalEngineArch } from '../engines/local-backend';
import { resolveTranscribeCli } from '../engines/transcribe-binary';
import type { Logger } from '../logging/logger';
import { PipeWireSystemAudio } from '../meetings/linux-system-audio';
import { MeetingRecorder, type MeetingCaptureHost, type SystemAudioPlan } from '../meetings/meeting-recorder';
import { MeetingStore } from '../meetings/meeting-store';
import { MeetingTranscriber } from '../meetings/meeting-transcriber';
import type { ModelManager } from '../models/model-manager';
import type { Diarizer } from '../models/diarizer';
import type { SettingsStore } from '../settings/settings-store';
import type { MainWindowEvents } from '../windows/main-window-controller';
import { desktopAppRoot } from './app-root';

export type MeetingWiringDeps = {
  captureWindow: MeetingCaptureHost;
  capture: Pick<AudioCapture, 'listDevices'>;
  models: ModelManager;
  diarizer: Diarizer;
  settings: SettingsStore;
  window: MainWindowEvents;
  logger: Logger;
};

export type Meetings = {
  store: MeetingStore;
  recorder: MeetingRecorder;
  transcriber: MeetingTranscriber;
  diarizer: Diarizer;
  modelReady(): boolean;
  load(): Promise<void>;
  isBusy(): boolean;
  shutdown(): Promise<void>;
};

function supportsMacSystemAudio(version: string): boolean {
  const [major = 0, minor = 0] = version.split('.').map(Number);
  return major > 14 || (major === 14 && minor >= 2);
}

function systemAudioPlan(): SystemAudioPlan {
  if (process.platform === 'linux') return { kind: 'source', source: new PipeWireSystemAudio() };
  if (process.platform === 'darwin' && supportsMacSystemAudio(process.getSystemVersion())) return { kind: 'capture-window' };
  return { kind: 'unsupported', note: 'Zvuk systému vyžaduje macOS 14.2 alebo novší.' };
}

export function createMeetings({ captureWindow, capture, models, diarizer, settings, window, logger }: MeetingWiringDeps): Meetings {
  const arch: LocalEngineArch = process.arch === 'arm64' ? 'arm64' : 'x64';
  const store = new MeetingStore(join(app.getPath('userData'), 'meetings'), logger);
  const recorder = new MeetingRecorder({
    store,
    capture: captureWindow,
    systemAudio: systemAudioPlan,
    microphoneId: async () => resolveDevice(await capture.listDevices(), settings.get().microphone).device?.deviceId ?? null,
    logger,
  });
  const transcriber = new MeetingTranscriber({
    store,
    binary: resolveTranscribeCli({ isPackaged: app.isPackaged, resourcesPath: process.resourcesPath, appPath: desktopAppRoot(), arch }),
    models,
    settings,
    backend: () => {
      const backend = localBackend(arch, settings.get().localAcceleration);
      return backend === 'auto' ? 'cpu' : backend;
    },
    diarizer: () => diarizer.modelPath(),
    logger,
  });
  store.onChange((meetings) => window.send('meetings-changed', meetings));
  diarizer.onChange((view) => window.send('diarizer-changed', view));
  return {
    store,
    recorder,
    transcriber,
    diarizer,
    modelReady: () => models.states().some((state) => state.id === settings.get().localModelId && state.status === 'ready'),
    load: () => store.load(),
    isBusy: () => recorder.isBusy() || transcriber.isBusy(),
    shutdown: async () => {
      await recorder.stop();
      await transcriber.abort();
    },
  };
}
