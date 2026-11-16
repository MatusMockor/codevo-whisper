import type { Transcriber, TranscriberCall } from './transcriber';

export type TranscriberSource = () => Transcriber;

export class LoadableTranscriber implements Transcriber {
  private current: Transcriber | null = null;

  constructor(private readonly create: TranscriberSource) {}

  transcribe(call: TranscriberCall): Promise<string> {
    return this.instance().transcribe(call);
  }

  ready(): boolean {
    return this.current?.ready() === true;
  }

  resident(): boolean {
    return this.current?.resident() === true;
  }

  warmUp(): Promise<void> {
    return this.instance().warmUp();
  }

  async unload(): Promise<void> {
    const loaded = this.current;
    this.current = null;
    await loaded?.close();
  }

  close(): Promise<void> {
    return this.unload();
  }

  private instance(): Transcriber {
    this.current ??= this.create();
    return this.current;
  }
}
