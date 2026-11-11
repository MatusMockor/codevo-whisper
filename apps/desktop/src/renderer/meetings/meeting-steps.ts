import type { SignalState } from '../home/transcription-route';
import { SET_UP_AI, type MeetingRemedy } from './meeting-remedies';

export type StepReadiness = { modelReady: boolean | null; diarizerReady: boolean | null; aiReady: boolean | null };

export type StepStatus = { tone: SignalState; label: string };

export type MeetingStep = { id: string; title: string; detail: string; status: StepStatus | null; remedy: MeetingRemedy | null };

type ReadyLabels = { ready: StepStatus; missing: StepStatus };

function status(ready: boolean | null, labels: ReadyLabels): StepStatus | null {
  if (ready === null) {
    return null;
  }
  return ready ? labels.ready : labels.missing;
}

const MODEL_LABELS: ReadyLabels = { ready: { tone: 'ok', label: 'Lokálny model je pripravený' }, missing: { tone: 'err', label: 'Chýba lokálny model' } };

const DIARIZER_LABELS: ReadyLabels = { ready: { tone: 'ok', label: 'Model je stiahnutý' }, missing: { tone: 'off', label: 'Voliteľné, model nie je stiahnutý' } };

const AI_LABELS: ReadyLabels = { ready: { tone: 'ok', label: 'AI úprava je nastavená' }, missing: { tone: 'off', label: 'AI úprava nie je nastavená' } };

export function meetingSteps({ modelReady, diarizerReady, aiReady }: StepReadiness): MeetingStep[] {
  return [
    { id: 'record', title: 'Nahrajte', detail: 'Mikrofón a zvuk systému ako dve stopy, bez časového limitu.', status: null, remedy: null },
    { id: 'transcribe', title: 'Prepíšte lokálne', detail: 'Po zastavení stretnutie prepíše lokálny model. Zvuk neopustí počítač.', status: status(modelReady, MODEL_LABELS), remedy: null },
    { id: 'speakers', title: 'Rozlíšte hovoriacich', detail: 'Voliteľný model označí v zvuku systému až štyroch hovoriacich.', status: status(diarizerReady, DIARIZER_LABELS), remedy: null },
    { id: 'notes', title: 'Vytvorte poznámky', detail: 'Zhrnutie, rozhodnutia, otvorené otázky a úlohy z prepisu.', status: status(aiReady, AI_LABELS), remedy: aiReady === false ? SET_UP_AI : null },
  ];
}
