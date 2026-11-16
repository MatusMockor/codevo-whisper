import { ProtocolError } from '@codevo-whisper/protocol';
import { readLimitedJson } from './read-limited-json';
import { NO_CAPABILITIES, parseSttCapabilities, type SttCapabilities, type SttCapabilityReport } from './stt-capabilities';
import { ModelLoadingError } from './model-loading-error';
import type { ModelPreparation, SttClient, SttHealth, SttHealthCheck, SttRequest, SttTranscript } from './stt-client';
import { parseSttTranscript } from './stt-transcript';

export const DEFAULT_STT_TIMEOUT_MS = 40_000;
export const MAX_STT_RESPONSE_BYTES = 128 * 1024;
export const MAX_CAPABILITIES_RESPONSE_BYTES = 16 * 1024;
export const CAPABILITIES_TIMEOUT_MS = 1_000;
export const PREPARE_TIMEOUT_MS = 300_000;
const HEALTH_TIMEOUT_MS = 2_000;
const MAX_REFUSAL_BYTES = 1024;
const MODEL_REFUSALS: readonly string[] = ['unknown model', 'model unavailable'];
const MODEL_LOADING = 'model loading';

function isBusy(value: unknown): boolean {
  return typeof value === 'object' && value !== null && (value as { busy?: unknown }).busy === true;
}

function unavailable(message: string, cause?: unknown): ProtocolError {
  return new ProtocolError('stt_unavailable', message, { cause });
}

function refusal(status: number, reason: string | null, request: SttRequest): Error {
  if (reason === MODEL_LOADING) {
    return new ModelLoadingError();
  }
  if (status === 503) {
    return new ProtocolError('busy', 'the STT engine is busy');
  }
  if (reason !== null && MODEL_REFUSALS.includes(reason)) {
    return new ProtocolError('model_unavailable', 'the STT engine cannot serve the requested model');
  }
  if (status === 409 && request.languages !== null) {
    return new ProtocolError('languages_unavailable', 'the STT engine cannot route dictation languages');
  }
  return unavailable(`the STT engine answered ${status}`);
}

function preparationRefusal(reason: string | null): ProtocolError {
  if (reason !== null && MODEL_REFUSALS.includes(reason)) {
    return new ProtocolError('model_unavailable', 'the STT engine cannot serve the requested model');
  }
  return unavailable('the STT engine could not load the requested model');
}

function prepareUrl(baseUrl: string, model: string): URL {
  const url = new URL('/prepare', baseUrl);
  url.searchParams.set('model', model);
  return url;
}

function transcribeUrl(baseUrl: string, request: SttRequest): URL {
  const url = new URL('/transcribe', baseUrl);
  url.searchParams.set('language', request.language);
  request.vocabulary.forEach((term) => url.searchParams.append('vocabulary', term));
  if (request.model !== null) {
    url.searchParams.set('model', request.model);
  }
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

function errorOf(body: unknown): string | null {
  const error = typeof body === 'object' && body !== null ? (body as { error?: unknown }).error : null;
  return typeof error === 'string' ? error : null;
}

async function refusalReason(response: Response, request: SttRequest): Promise<string | null> {
  if (request.model === null) {
    await discard(response);
    return null;
  }
  return errorOf(await readLimitedJson(response, MAX_REFUSAL_BYTES).catch(() => null));
}

export class HttpSttClient implements SttClient, SttHealthCheck, SttCapabilities, ModelPreparation {
  constructor(
    private readonly baseUrl: string,
    private readonly timeoutMs = DEFAULT_STT_TIMEOUT_MS,
    private readonly prepareTimeoutMs = PREPARE_TIMEOUT_MS,
  ) {}

  async transcribe(request: SttRequest, signal: AbortSignal): Promise<SttTranscript> {
    signal.throwIfAborted();
    const init = { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: request.pcm };
    const response = await this.post(transcribeUrl(this.baseUrl, request), init, signal, this.timeoutMs);
    if (!response.ok) {
      throw refusal(response.status, await refusalReason(response, request), request);
    }
    return parseSttTranscript(await readLimitedJson(response, MAX_STT_RESPONSE_BYTES), request);
  }

  async prepare(model: string, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    const response = await this.post(prepareUrl(this.baseUrl, model), { method: 'POST' }, signal, this.prepareTimeoutMs);
    if (!response.ok) {
      throw preparationRefusal(errorOf(await readLimitedJson(response, MAX_REFUSAL_BYTES).catch(() => null)));
    }
    await discard(response);
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

  private async post(url: URL, init: RequestInit, signal: AbortSignal, timeoutMs: number): Promise<Response> {
    try {
      return await fetch(url, { ...init, signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) });
    } catch (error) {
      if (signal.aborted) {
        throw signal.reason;
      }
      throw unavailable('the STT engine is unreachable', error);
    }
  }
}
