import { describe, expect, it } from 'vitest';
import { LastTranscript } from '../src/main/insertion/last-transcript';
import { RecordingLogger } from './recording-logger';

describe('LastTranscript', () => {
  it('notifies listeners about every new transcript and isolates failing listeners', () => {
    const logger = new RecordingLogger();
    const last = new LastTranscript(logger);
    const seen: string[] = [];
    last.onChange(() => {
      throw new Error('listener broke');
    });
    const unsubscribe = last.onChange((text) => seen.push(text));

    last.set('prvý');
    last.set('druhý');
    unsubscribe();
    last.set('tretí');

    expect(seen).toEqual(['prvý', 'druhý']);
    expect(last.get()).toBe('tretí');
    expect(logger.errors).toHaveLength(3);
  });
});
