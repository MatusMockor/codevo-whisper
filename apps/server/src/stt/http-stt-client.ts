import { MAX_TEXT_CHARS, ProtocolError, type Language } from '@codevo-whisper/protocol';
import { readLimitedJson } from './read-limited-json';
import type { SttClient, SttHealth, SttHealthCheck } from './stt-client';

export const DEFAULT_STT_TIMEOUT_MS = 40_000;
export const MAX_STT_RESPONSE_BYTES = 128 * 1024;
const HEALTH_TIMEOUT_MS = 2_000;

function hasText(value: unknown): value is { text: string } {
  return typeof value === 'object' && value !== null && typeof (value as { text?: unknown }).text === 'string';
}

function isBusy(value: unknown): boolean {
  return typeof value === 'object' && value !== null && (value as { busy?: unknown }).busy === true;
}

function unavailable(message: string, cause?: unknown): ProtocolError {
  return new ProtocolError('stt_unavailable', message, { cause });
}

export class HttpSttClient implements SttClient, SttHealthCheck {
  constructor(
    private readonly baseUrl: string,
    private readonly timeoutMs = DEFAULT_STT_TIMEOUT_MS,
  ) {}

  async transcribe(pcm: Uint8Array, language: Language, signal: AbortSignal): Promise<string> {
    signal.throwIfAborted();
    const response = await this.post(pcm, language, signal);
    if (response.status === 503) {
      await response.body?.cancel().catch(() => undefined);
      throw new ProtocolError('busy', 'the STT engine is busy');
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw unavailable(`the STT engine answered ${response.status}`);
    }
    const body = await readLimitedJson(response, MAX_STT_RESPONSE_BYTES);
    if (!hasText(body)) {
      throw unavailable('the STT engine sent no text');
    }
    if ([...body.text].length > MAX_TEXT_CHARS) {
      throw unavailable('the STT engine sent more text than the protocol allows');
    }
    return body.text;
  }

  async health(): Promise<SttHealth> {
    try {
      const response = await fetch(new URL('/health', this.baseUrl), { signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS) });
      if (!response.ok) {
        return 'DOWN';
      }
      return isBusy(await response.json()) ? 'BUSY' : 'UP';
    } catch {
      return 'DOWN';
    }
  }

  private async post(pcm: Uint8Array, language: Language, signal: AbortSignal): Promise<Response> {
    const url = new URL('/transcribe', this.baseUrl);
    url.searchParams.set('language', language);
    try {
      return await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/octet-stream' },
        body: pcm,
        signal: AbortSignal.any([signal, AbortSignal.timeout(this.timeoutMs)]),
      });
    } catch (error) {
      if (signal.aborted) {
        throw signal.reason;
      }
      throw unavailable('the STT engine is unreachable', error);
    }
  }
}
