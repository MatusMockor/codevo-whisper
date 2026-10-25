import { PCM_PROCESSOR_NAME } from '../../shared/capture-contract';
import { PcmFramer } from '../../shared/pcm-framer';

declare const sampleRate: number;

declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor(options?: AudioWorkletNodeOptions);
}

declare function registerProcessor(name: string, processor: new (options: AudioWorkletNodeOptions) => AudioWorkletProcessor): void;

class PcmCaptureProcessor extends AudioWorkletProcessor {
  private readonly framer: PcmFramer;

  constructor(options: AudioWorkletNodeOptions) {
    super(options);
    const emitFrames = (options.processorOptions as { emitFrames?: unknown } | undefined)?.emitFrames === true;
    this.framer = new PcmFramer(sampleRate, emitFrames, {
      frame: (pcm) => {
        this.port.postMessage({ type: 'frame', pcm }, [pcm.buffer]);
      },
      level: (rms) => {
        this.port.postMessage({ type: 'level', rms });
      },
    });
    this.port.onmessage = () => {
      const pcm = this.framer.flush();
      this.port.postMessage({ type: 'flushed', pcm }, [pcm.buffer]);
    };
  }

  process(inputs: Float32Array[][]): boolean {
    const channel = inputs[0]?.[0];
    if (channel !== undefined) {
      this.framer.push(channel);
    }
    return true;
  }
}

registerProcessor(PCM_PROCESSOR_NAME, PcmCaptureProcessor);
