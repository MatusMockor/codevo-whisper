import { describe, expect, it } from 'vitest';
import { notesRemedy, START_FAILURE_REMEDIES } from '../src/renderer/meetings/meeting-remedies';
import { meetingSteps } from '../src/renderer/meetings/meeting-steps';
import { notesFailureMessage } from '../src/renderer/meetings/meeting-copy';
import type { NotesFailure } from '../src/shared/meetings';

const AI = { page: 'settings', section: 'ai' };

describe('notesRemedy', () => {
  it('sends a missing AI setup straight to the AI settings group', () => {
    expect(notesRemedy('not-configured')).toEqual({ id: 'set-up-ai', label: 'Nastaviť AI úpravu', target: AI });
  });

  it('points AI server and Codex CLI failures to the AI settings group with a specific label', () => {
    for (const failure of ['timeout', 'unreachable', 'unauthorized', 'http', 'bad-response'] as const) {
      expect(notesRemedy(failure)).toMatchObject({ label: 'Skontrolovať AI server', target: AI });
    }
    for (const failure of ['codex-not-found', 'codex-logged-out', 'codex-failed'] as const) {
      expect(notesRemedy(failure)).toMatchObject({ label: 'Skontrolovať Codex CLI', target: AI });
    }
  });

  it('offers no settings link when only trying again helps', () => {
    const retryOnly: NotesFailure[] = ['aborted', 'too-large', 'too-long', 'empty', 'unexpected'];
    expect(retryOnly.map(notesRemedy)).toEqual(retryOnly.map(() => null));
  });

  it('keeps the failure messages free of generic Nastavenia directions', () => {
    const failures: NotesFailure[] = ['timeout', 'aborted', 'unreachable', 'unauthorized', 'http', 'too-large', 'bad-response', 'codex-not-found', 'codex-logged-out', 'codex-failed', 'not-configured', 'too-long', 'empty', 'unexpected'];
    expect(failures.filter((failure) => notesFailureMessage(failure).includes('Nastaveniach'))).toEqual([]);
  });
});

describe('START_FAILURE_REMEDIES', () => {
  it('links a failed recording start to the microphone group and the local model section', () => {
    expect(START_FAILURE_REMEDIES).toEqual([
      { id: 'check-microphone', label: 'Skontrolovať mikrofón', target: { page: 'settings', section: 'microphone' } },
      { id: 'check-model', label: 'Skontrolovať lokálny model', target: { page: 'transcription', section: 'local-model' } },
    ]);
  });
});

describe('meetingSteps', () => {
  it('shows the readiness of every step and links the missing AI setup', () => {
    const steps = meetingSteps({ modelReady: false, diarizerReady: true, aiReady: false });

    expect(steps.map((step) => step.id)).toEqual(['record', 'transcribe', 'speakers', 'notes']);
    expect(steps.map((step) => step.status)).toEqual([
      null,
      { tone: 'err', label: 'Chýba lokálny model' },
      { tone: 'ok', label: 'Model je stiahnutý' },
      { tone: 'off', label: 'AI úprava nie je nastavená' },
    ]);
    expect(steps.map((step) => step.remedy?.target ?? null)).toEqual([null, null, null, AI]);
  });

  it('drops the AI link once the AI is set up and hides unknown states', () => {
    const steps = meetingSteps({ modelReady: true, diarizerReady: null, aiReady: true });

    expect(steps.map((step) => step.status?.label ?? null)).toEqual([null, 'Lokálny model je pripravený', null, 'AI úprava je nastavená']);
    expect(steps.every((step) => step.remedy === null)).toBe(true);
  });
});
