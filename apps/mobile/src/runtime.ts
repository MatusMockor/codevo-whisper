import { base64 } from '@scure/base';
import type { Language } from '@codevo-whisper/protocol';
import { parsePairing, startSession } from './core/pairing';
import type { MobileSession } from './core/session';
import { native, openWire, subscribeVoice, vault } from './platform';

export type RecordingState = 'Connecting' | 'Recording' | 'Finishing';
export async function runRecording(
  runId: string,
  language: Language,
  onState: (state: RecordingState) => void = () => undefined,
): Promise<string> {
  const abort = new AbortController();
  let session: MobileSession | undefined;
  let sequence = 0;
  let capturing = false;
  let stopping = false;
  let resolveEnd: () => void = () => undefined;
  let rejectEnd: (error: Error) => void = () => undefined;
  const ended = new Promise<void>((resolve, reject) => {
    resolveEnd = resolve;
    rejectEnd = reject;
  });
  void ended.catch(() => undefined);
  const cancel = () => {
    abort.abort();
    session?.cancel();
    rejectEnd(new Error('Recording cancelled'));
  };
  const unsubscribe = subscribeVoice((event) => {
    if (event.runId !== runId) {
      return;
    }
    if (event.type === 'cancel') {
      cancel();
      return;
    }
    if (event.type === 'stop') {
      if (!capturing) {
        cancel();
        return;
      }
      stopping = true;
      onState('Finishing');
      void native.stopCapture(runId).catch(cancel);
      return;
    }
    if (event.type === 'ended') {
      if (!stopping) {
        cancel();
        return;
      }
      resolveEnd();
      return;
    }
    if (!capturing || event.sequence !== sequence++) {
      cancel();
      return;
    }
    const pcm = base64.decode(event.pcm);
    if (pcm.length === 0 || pcm.length > 3200 || pcm.length % 2 !== 0) {
      cancel();
      return;
    }
    session?.push(pcm);
    native.acknowledge(runId, event.sequence);
  }, cancel);
  try {
    onState('Connecting');
    if (!(await native.ready(runId))) {
      throw new Error('Recording cancelled');
    }
    const stored = await vault.load();
    if (stored === null) {
      throw new Error('Open Codevo Voice and pair a server first');
    }
    if (abort.signal.aborted) {
      throw new Error('Recording cancelled');
    }
    session = await startSession(parsePairing(stored), runId, language, openWire, abort.signal);
    void session.completion.catch(() => {
      rejectEnd(new Error('Server session failed'));
    });
    capturing = true;
    await native.capture(runId);
    onState('Recording');
    await ended;
    const text = await session.finish();
    if (abort.signal.aborted || !(await native.complete(runId, text))) {
      throw new Error('Editor changed. Text was not inserted.');
    }
    return text;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Recording failed';
    await native.terminal(runId, message);
    throw new Error(message, { cause: error });
  } finally {
    capturing = false;
    unsubscribe();
    session?.cancel();
    abort.abort();
    await native.stopCapture(runId);
  }
}

export async function runHeadless(data: unknown): Promise<void> {
  if (typeof data !== 'object' || data === null || !('runId' in data) || typeof data.runId !== 'string') {
    return;
  }
  try {
    await runRecording(data.runId, 'auto');
  } catch {
    return;
  }
}
