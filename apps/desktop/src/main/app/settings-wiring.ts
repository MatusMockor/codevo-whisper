import type { AudioCapture } from '../audio/audio-capture';
import { MicrophoneMeter } from '../audio/microphone-meter';
import { MicrophoneSettings } from '../audio/microphone-settings';
import type { Logger } from '../logging/logger';
import { ModelActions } from '../models/model-actions';
import type { ModelManager } from '../models/model-manager';
import type { SettingsStore } from '../settings/settings-store';
import { electronLoginItem, syncLoginItem, unpackagedLoginItem } from '../system/login-item';
import type { MainWindowEvents } from '../windows/main-window-controller';

export type SettingsWiringDeps = {
  capture: AudioCapture;
  models: ModelManager;
  settings: SettingsStore;
  window: MainWindowEvents;
  isPackaged: boolean;
  logger: Logger;
};

export type SettingsServices = { actions: ModelActions; microphones: MicrophoneSettings; dispose(): void };

export function createSettingsServices({ capture, models, settings, window, isPackaged, logger }: SettingsWiringDeps): SettingsServices {
  const actions = new ModelActions({ models, settings });
  const meter = new MicrophoneMeter(capture, (rms) => window.send('microphone-level', rms));
  const microphones = new MicrophoneSettings(capture, meter, (devices) => window.send('microphones-changed', devices));
  const unsubscribers = [
    models.onChange((states) => window.send('model-states-changed', states)),
    window.onClose(() => {
      meter.stop().catch((error: unknown) => {
        logger.error('The microphone meter could not be stopped', error);
      });
    }),
    syncLoginItem(settings, isPackaged ? electronLoginItem : unpackagedLoginItem(logger), logger),
  ];
  return {
    actions,
    microphones,
    dispose: () => {
      for (const unsubscribe of unsubscribers.splice(0)) {
        unsubscribe();
      }
      microphones.dispose();
    },
  };
}
