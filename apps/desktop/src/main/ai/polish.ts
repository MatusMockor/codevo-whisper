import type { AiFailure } from '../../shared/ai';
import type { FieldContext } from '../helper/input-helper';
import type { Logger } from '../logging/logger';
import { LlmError, type Complete } from './llm-client';
import { polishMessages } from './prompts';

export type PolishRequest = { text: string; words: readonly string[]; context: FieldContext | null };

export type PolishOptions = { complete: Complete; signal: AbortSignal; logger: Logger; instructions?: string; timeoutMs?: number };

export type Polished = { text: string; failure: AiFailure | null };

const POLISH_TIMEOUT_MS = 8_000;
const COPY_WINDOW = 24;

function plausibleEdit(input: string, output: string): boolean {
  return output.length >= input.length * 0.3 && output.length <= input.length * 2 + 40;
}

function normalizeSpace(text: string): string {
  return text.replace(/\s+/g, ' ');
}

function copiesContext(transcript: string, output: string, context: FieldContext | null): boolean {
  if (!context) return false;
  const spoken = normalizeSpace(transcript);
  const answer = normalizeSpace(output);
  return [context.before, context.after].some((side) => {
    const excerpt = normalizeSpace(side);
    for (let start = 0; start + COPY_WINDOW <= excerpt.length; start++) {
      const window = excerpt.slice(start, start + COPY_WINDOW);
      if (answer.includes(window) && !spoken.includes(window)) return true;
    }
    return false;
  });
}

export async function polish({ text, words, context }: PolishRequest, { complete, signal, logger, instructions = '', timeoutMs = POLISH_TIMEOUT_MS }: PolishOptions): Promise<Polished> {
  try {
    const edited = await complete(polishMessages({ transcript: text, words, instructions, context }), { timeoutMs, signal });
    if (plausibleEdit(text, edited) && !copiesContext(text, edited, context)) {
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
