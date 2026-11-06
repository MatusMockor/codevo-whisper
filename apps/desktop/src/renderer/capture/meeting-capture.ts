import type { MeetingCaptureResult, MeetingFrame } from '../../shared/capture-contract';
import type { MeetingTrack } from '../../shared/meetings';
import { MicrophoneSession } from './microphone-session';

type Send = (frame: MeetingFrame) => void;

function trackSink(track: MeetingTrack, send: Send) {
  return {
    frame: (pcm: Uint8Array) => {
      send({ track, pcm });
    },
    level: () => undefined,
  };
}

async function openSystem(send: Send): Promise<MicrophoneSession | null> {
  const stream = await navigator.mediaDevices.getDisplayMedia({ audio: true, video: true }).catch(() => null);
  if (stream === null) {
    return null;
  }
  for (const video of stream.getVideoTracks()) {
    video.stop();
    stream.removeTrack(video);
  }
  if (stream.getAudioTracks().every((track) => track.readyState === 'ended')) {
    return null;
  }
  return MicrophoneSession.attach(stream, 'record', trackSink('system', send));
}

export class MeetingCapture {
  private constructor(
    private readonly mic: MicrophoneSession,
    private readonly system: MicrophoneSession | null,
  ) {}

  static async open(deviceId: string | null, system: boolean, send: Send): Promise<{ capture: MeetingCapture; result: MeetingCaptureResult }> {
    const mic = await MicrophoneSession.open(deviceId, 'record', trackSink('mic', send));
    const systemSession = system ? await openSystem(send).catch(() => null) : null;
    const state = !system ? 'off' : systemSession === null ? 'failed' : 'recording';
    return { capture: new MeetingCapture(mic, systemSession), result: { label: mic.label, fallback: mic.fallback, system: state } };
  }

  async close(): Promise<void> {
    await Promise.all([this.mic.close(), this.system?.close()]);
  }
}
