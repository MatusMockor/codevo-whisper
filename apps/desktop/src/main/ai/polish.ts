import type { AiFailure } from '../../shared/ai';
import type { Logger } from '../logging/logger';
import { LlmError, type Complete } from './llm-client';
import { polishMessages } from './prompts';

export type PolishOptions = { complete: Complete; signal: AbortSignal; logger: Logger; timeoutMs?: number };

export type Polished = { text: string; failure: AiFailure | null };

const POLISH_TIMEOUT_MS = 8_000;

function plausibleEdit(input: string, output: string): boolean {
  return output.length >= input.length * 0.3 && output.length <= input.length * 2 + 40;
}

export async function polish(text: string, { complete, signal, logger, timeoutMs = POLISH_TIMEOUT_MS }: PolishOptions): Promise<Polished> {
  try {
    const edited = await complete(polishMessages(text), { timeoutMs, signal });
    if (plausibleEdit(text, edited)) {
      return { text: edited, failure: null };
    }
    logger.warn('The polished dictation was discarded, inserting the raw transcript', { inputChars: text.length, outputChars: edited.length });
  } catch (error) {
    const reason = error instanceof LlmError ? error.reason : null;
    logger.warn('The dictation polish failed, inserting the raw transcript', { reason: reason ?? 'unexpected' });
    return { text, failure: reason };
  }
  return { text, failure: null };
}
