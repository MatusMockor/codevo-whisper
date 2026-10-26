import { ProtocolError } from '@codevo-whisper/protocol';

const utf8 = new TextDecoder('utf-8', { fatal: true });

function unavailable(message: string, cause?: unknown): ProtocolError {
  return new ProtocolError('stt_unavailable', message, { cause });
}

async function readLimited(response: Response, maxBytes: number): Promise<Uint8Array> {
  const declared = Number(response.headers.get('content-length') ?? '0');
  if (declared > maxBytes) {
    await response.body?.cancel();
    throw unavailable(`the STT response is too large (${declared} bytes)`);
  }
  const reader: ReadableStreamDefaultReader<Uint8Array> | undefined = response.body?.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (let next = await reader?.read(); next !== undefined && !next.done; next = await reader?.read()) {
    total += next.value.byteLength;
    if (total > maxBytes) {
      await reader?.cancel();
      throw unavailable(`the STT response is too large (more than ${maxBytes} bytes)`);
    }
    chunks.push(next.value);
  }
  return Buffer.concat(chunks);
}

export async function readLimitedJson(response: Response, maxBytes: number): Promise<unknown> {
  const bytes = await readLimited(response, maxBytes);
  try {
    return JSON.parse(utf8.decode(bytes)) as unknown;
  } catch (error) {
    throw unavailable('the STT engine sent invalid JSON', error);
  }
}
