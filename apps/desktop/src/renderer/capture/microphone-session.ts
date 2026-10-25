import { PCM_PROCESSOR_NAME, type CaptureMode } from '../../shared/capture-contract';
import type { PcmSink } from '../../shared/pcm-framer';
import { openWithFallback } from './open-with-fallback';
import workletUrl from './pcm-worklet.ts?worker&url';

const FLUSH_TIMEOUT_MS = 1000;

type WorkletMessage = { type: 'frame'; pcm: Uint8Array } | { type: 'level'; rms: number } | { type: 'flushed'; pcm: Uint8Array };

function audioConstraints(deviceId: string | null): MediaTrackConstraints {
  const processing = { echoCancellation: false, noiseSuppression: false, autoGainControl: true };
  if (deviceId === null) {
    return processing;
  }
  return { ...processing, deviceId: { exact: deviceId } };
}

async function release(stream: MediaStream, context: AudioContext): Promise<void> {
  for (const track of stream.getTracks()) {
    track.stop();
  }
  await context.close().catch(() => undefined);
}

async function connect(stream: MediaStream, context: AudioContext, mode: CaptureMode): Promise<AudioWorkletNode> {
  await context.audioWorklet.addModule(workletUrl);
  const node = new AudioWorkletNode(context, PCM_PROCESSOR_NAME, {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    channelCount: 1,
    channelCountMode: 'explicit',
    channelInterpretation: 'speakers',
    processorOptions: { emitFrames: mode === 'record' },
  });
  context.createMediaStreamSource(stream).connect(node);
  node.connect(context.destination);
  await context.resume();
  return node;
}

export class MicrophoneSession {
  private onFlushed: ((pcm: Uint8Array) => void) | null = null;

  private constructor(
    private readonly stream: MediaStream,
    private readonly context: AudioContext,
    private readonly node: AudioWorkletNode,
    private readonly sink: PcmSink,
    readonly fallback: boolean,
  ) {
    node.port.onmessage = (event: MessageEvent<WorkletMessage>) => {
      this.receive(event.data);
    };
  }

  static async open(deviceId: string | null, mode: CaptureMode, sink: PcmSink): Promise<MicrophoneSession> {
    const { value: stream, fallback } = await openWithFallback(
      (id) => navigator.mediaDevices.getUserMedia({ audio: audioConstraints(id), video: false }),
      deviceId,
    );
    const context = new AudioContext();
    try {
      return new MicrophoneSession(stream, context, await connect(stream, context, mode), sink, fallback);
    } catch (error) {
      await release(stream, context);
      throw error;
    }
  }

  get label(): string {
    return this.stream.getAudioTracks()[0]?.label ?? '';
  }

  async close(): Promise<void> {
    try {
      const rest = await this.flush();
      if (rest.byteLength > 0) {
        this.sink.frame(rest);
      }
    } finally {
      this.node.port.onmessage = null;
      this.node.disconnect();
      await release(this.stream, this.context);
    }
  }

  private flush(): Promise<Uint8Array> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.onFlushed = null;
        resolve(new Uint8Array(0));
      }, FLUSH_TIMEOUT_MS);
      this.onFlushed = (pcm) => {
        clearTimeout(timer);
        this.onFlushed = null;
        resolve(pcm);
      };
      this.node.port.postMessage({ type: 'flush' });
    });
  }

  private receive(message: WorkletMessage): void {
    if (message.type === 'level') {
      this.sink.level(message.rms);
      return;
    }
    if (message.type === 'frame') {
      this.sink.frame(message.pcm);
      return;
    }
    this.onFlushed?.(message.pcm);
  }
}
