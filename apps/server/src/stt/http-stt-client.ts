import { ProtocolError } from '@codevo-whisper/protocol';
import { readLimitedJson } from './read-limited-json';
import { NO_CAPABILITIES, parseSttCapabilities, type SttCapabilities, type SttCapabilityReport } from './stt-capabilities';
import type { SttClient, SttHealth, SttHealthCheck, SttRequest, SttTranscript } from './stt-client';
import { parseSttTranscript } from './stt-transcript';

export const DEFAULT_STT_TIMEOUT_MS = 40_000;
export const MAX_STT_RESPONSE_BYTES = 128 * 1024;
export const MAX_CAPABILITIES_RESPONSE_BYTES = 16 * 1024;
export const CAPABILITIES_TIMEOUT_MS = 1_000;
const HEALTH_TIMEOUT_MS = 2_000;

function isBusy(value: unknown): boolean {
  return typeof value === 'object' && value !== null && (value as { busy?: unknown }).busy === true;
}

function unavailable(message: string, cause?: unknown): ProtocolError {
  return new ProtocolError('stt_unavailable', message, { cause });
}

function refusal(status: number): ProtocolError {
  if (status === 503) {
    return new ProtocolError('busy', 'the STT engine is busy');
  }
  if (status === 409) {
    return new ProtocolError('languages_unavailable', 'the STT engine cannot route dictation languages');
  }
  return unavailable(`the STT engine answered ${status}`);
}

function transcribeUrl(baseUrl: string, request: SttRequest): URL {
  const url = new URL('/transcribe', baseUrl);
  url.searchParams.set('language', request.language);
  if (request.languages === null) {
    return url;
  }
  url.searchParams.set('languages', request.languages.join(','));
  url.searchParams.set('kind', request.kind);
  return url;
}

async function discard(response: Response): Promise<void> {
  await response.body?.cancel().catch(() => undefined);
}

export class HttpSttClient implements SttClient, SttHealthCheck, SttCapabilities {
  constructor(
    private readonly baseUrl: string,
    private readonly timeoutMs = DEFAULT_STT_TIMEOUT_MS,
  ) {}

  async transcribe(request: SttRequest, signal: AbortSignal): Promise<SttTranscript> {
    signal.throwIfAborted();
    const response = await this.post(request, signal);
    if (!response.ok) {
      await discard(response);
      throw refusal(response.status);
    }
    return parseSttTranscript(await readLimitedJson(response, MAX_STT_RESPONSE_BYTES), request);
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

  async capabilities(): Promise<SttCapabilityReport> {
    try {
      const response = await fetch(new URL('/capabilities', this.baseUrl), { signal: AbortSignal.timeout(CAPABILITIES_TIMEOUT_MS) });
      if (!response.ok) {
        await discard(response);
        return NO_CAPABILITIES;
      }
      return parseSttCapabilities(await readLimitedJson(response, MAX_CAPABILITIES_RESPONSE_BYTES));
    } catch {
      return NO_CAPABILITIES;
    }
  }

  private async post(request: SttRequest, signal: AbortSignal): Promise<Response> {
    try {
      return await fetch(transcribeUrl(this.baseUrl, request), {
        method: 'POST',
        headers: { 'content-type': 'application/octet-stream' },
        body: request.pcm,
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
