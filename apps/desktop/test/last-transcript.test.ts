import { describe, expect, it } from 'vitest';
import { LastTranscript } from '../src/main/insertion/last-transcript';
import { RecordingLogger } from './recording-logger';

describe('LastTranscript', () => {
  it('stores and announces the explicitly suffixed sanitized transcript', () => {
    const last = new LastTranscript();
    const seen: string[] = [];
    last.onChange((text) => seen.push(text));
    last.set(' Žilina\r\n\u0000 ', { appendTrailingSpace: true });
    expect(last.get()).toBe('Žilina ');
    expect(seen).toEqual(['Žilina ']);
    last.set(' \n ', { appendTrailingSpace: true });
    expect(last.get()).toBe('Žilina ');
  });
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

  it('stores and announces only sanitized text', () => {
    const last = new LastTranscript(new RecordingLogger());
    const seen: string[] = [];
    last.onChange((text) => seen.push(text));

    last.set('Dobrý deň,\r\nďakujem\u001b[201~\u202e');

    expect(last.get()).toBe('Dobrý deň, ďakujem[201~');
    expect(seen).toEqual(['Dobrý deň, ďakujem[201~']);
  });

  it('ignores text that is empty after sanitizing and keeps the previous transcript', () => {
    const last = new LastTranscript(new RecordingLogger());
    const seen: string[] = [];
    last.set('prvý');
    last.onChange((text) => seen.push(text));

    last.set(' \n\u0000\u200b ');

    expect(last.get()).toBe('prvý');
    expect(seen).toEqual([]);
  });
});
