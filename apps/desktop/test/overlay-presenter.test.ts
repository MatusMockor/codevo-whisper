import { afterEach, describe, expect, it, vi } from 'vitest';
import { NOTICE_MS, OverlayPresenter, RESULT_MS } from '../src/main/session/overlay-presenter';
import type { OverlayState } from '../src/shared/overlay-contract';

afterEach(() => {
  vi.useRealTimers();
});

describe('OverlayPresenter', () => {
  it('keeps an inserted result with a notice up as long as an error', () => {
    vi.useFakeTimers();
    const states: OverlayState[] = [];
    const presenter = new OverlayPresenter((state) => states.push(state));
    const owner = {};

    presenter.flash(owner, { kind: 'inserted', appName: 'TextEdit', notice: 'Codex CLI sa nenašiel. Nainštalujte ho alebo skontrolujte PATH.' });
    vi.advanceTimersByTime(RESULT_MS);
    expect(states.at(-1)?.kind).toBe('inserted');
    vi.advanceTimersByTime(NOTICE_MS - RESULT_MS);
    expect(states.at(-1)).toEqual({ kind: 'hidden' });
  });
});
