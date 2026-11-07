import { isAiModel, type AiFailure } from '../../shared/ai';
import { isPlainRecord } from '../settings/settings-fields';

export type LlmEndpoint = { baseUrl: string; model: string; apiKey: string | null };

export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

export type ChatRequest = { endpoint: LlmEndpoint; messages: readonly ChatMessage[]; timeoutMs: number; signal?: AbortSignal };

export class LlmError extends Error {
  override readonly name = 'LlmError';

  constructor(
    readonly reason: AiFailure,
    message: string,
  ) {
    super(message);
  }
}

const MAX_RESPONSE_BYTES = 1024 * 1024;
const MODELS_TIMEOUT_MS = 5_000;
const THINK_BLOCKS = /<think>[\s\S]*?(?:<\/think>|$)/g;

function endpointUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/${path}`;
}

function headers(apiKey: string | null, body: boolean): Record<string, string> {
  return { accept: 'application/json', ...(body ? { 'content-type': 'application/json' } : {}), ...(apiKey === null ? {} : { authorization: `Bearer ${apiKey}` }) };
}

async function readCapped(response: Response): Promise<string> {
  if (response.body === null) {
    return '';
  }
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of response.body as AsyncIterable<unknown>) {
    if (!(chunk instanceof Uint8Array)) {
      throw new LlmError('bad-response', 'the response body is not bytes');
    }
    size += chunk.byteLength;
    if (size > MAX_RESPONSE_BYTES) {
      throw new LlmError('too-large', 'the response is larger than 1 MB');
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function failure(error: unknown, timeout: AbortSignal, caller: AbortSignal | undefined): LlmError {
  if (error instanceof LlmError) return error;
  if (caller?.aborted === true) return new LlmError('aborted', 'the request was cancelled');
  if (timeout.aborted) return new LlmError('timeout', 'the server did not answer in time');
  return new LlmError('unreachable', 'the server could not be reached');
}

async function requestJson(url: string, init: { method: 'GET' | 'POST'; apiKey: string | null; body?: string; timeoutMs: number; signal?: AbortSignal | undefined }): Promise<unknown> {
  const timeout = AbortSignal.timeout(init.timeoutMs);
  const signal = init.signal === undefined ? timeout : AbortSignal.any([init.signal, timeout]);
  let text: string;
  try {
    const response = await fetch(url, { method: init.method, headers: headers(init.apiKey, init.body !== undefined), body: init.body ?? null, signal, redirect: 'error' });
    if (!response.ok) {
      await response.body?.cancel();
      throw new LlmError(response.status === 401 || response.status === 403 ? 'unauthorized' : 'http', `the server answered ${response.status}`);
    }
    text = await readCapped(response);
  } catch (error) {
    throw failure(error, timeout, init.signal);
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new LlmError('bad-response', 'the response is not JSON');
  }
}

function completionContent(body: unknown): string {
  const choices = isPlainRecord(body) ? body['choices'] : undefined;
  const first: unknown = Array.isArray(choices) ? choices[0] : undefined;
  const message = isPlainRecord(first) ? first['message'] : undefined;
  const content = isPlainRecord(message) ? message['content'] : undefined;
  if (typeof content !== 'string') {
    throw new LlmError('bad-response', 'the response has no completion text');
  }
  if (isPlainRecord(first) && first['finish_reason'] === 'length') {
    throw new LlmError('bad-response', 'the completion was cut off at the token limit');
  }
  return content.replace(THINK_BLOCKS, '').trim();
}

export async function chat({ endpoint, messages, timeoutMs, signal }: ChatRequest): Promise<string> {
  const body = JSON.stringify({ model: endpoint.model, messages, temperature: 0.2, stream: false });
  return completionContent(await requestJson(endpointUrl(endpoint.baseUrl, 'chat/completions'), { method: 'POST', apiKey: endpoint.apiKey, body, timeoutMs, signal }));
}

export async function listModels(endpoint: Pick<LlmEndpoint, 'baseUrl' | 'apiKey'>): Promise<string[]> {
  const body = await requestJson(endpointUrl(endpoint.baseUrl, 'models'), { method: 'GET', apiKey: endpoint.apiKey, timeoutMs: MODELS_TIMEOUT_MS });
  const data = isPlainRecord(body) ? body['data'] : undefined;
  if (!Array.isArray(data)) {
    throw new LlmError('bad-response', 'the response has no model list');
  }
  return data.flatMap((entry: unknown) => {
    const id = isPlainRecord(entry) ? entry['id'] : undefined;
    return isAiModel(id) && id !== '' ? [id] : [];
  });
}
