import { useEffect, useState } from 'react';
import { liveValueOr, useLiveValue } from '../home/live-value';
import type { AudioDevice } from '../../shared/microphones';
import type { MicrophoneSetting } from '../../shared/settings';

const loadMicrophones = () => window.codevo.getMicrophones();

export function useMicrophones(): AudioDevice[] {
  return liveValueOr(useLiveValue('microphones-changed', loadMicrophones), []);
}

export type MicrophoneLevel = { level: number; failed: boolean };

const PEAK_DECAY = 0.85;

export function useMicrophoneLevel({ deviceId, label }: MicrophoneSetting): MicrophoneLevel {
  const [level, setLevel] = useState<MicrophoneLevel>({ level: 0, failed: false });

  useEffect(() => {
    let active = true;
    const unsubscribe = window.codevo.on('microphone-level', (rms) => setLevel((current) => ({ level: Math.max(rms, current.level * PEAK_DECAY), failed: false })));
    window.codevo.startMicrophoneMeter({ deviceId, label }).catch((error: unknown) => {
      console.error('Opening the microphone meter failed', error);
      if (active) {
        setLevel({ level: 0, failed: true });
      }
    });
    return () => {
      active = false;
      unsubscribe();
      window.codevo.stopMicrophoneMeter().catch((error: unknown) => {
        console.error('Closing the microphone meter failed', error);
      });
    };
  }, [deviceId, label]);

  return level;
}
