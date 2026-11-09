import { describe, expect, it } from 'vitest';
import { readinessError } from '../src/main/session/overlay-messages';
import { bannerContent } from '../src/renderer/home/banner-content';
import { engineIssue } from '../src/renderer/home/engine-issue';
import { pathHeader, railBadges, readinessSummary } from '../src/renderer/home/readiness';
import { readinessActions, type ReadinessAction } from '../src/renderer/home/readiness-actions';
import { signalPathNodes, type PathNode } from '../src/renderer/home/signal-path';
import { transcriptionRoute } from '../src/renderer/home/transcription-route';
import { engineCapabilities } from '../src/renderer/settings/engine-capabilities';
import type { AppStatus } from '../src/shared/app-status';
import { isModelReady, type ModelState } from '../src/shared/models';
import type { EngineUnavailableReason } from '../src/main/engines/transcription-engine';
import type { OverlayAction } from '../src/shared/overlay-contract';
import type { PairedServerView, ServerStatus, ServerView } from '../src/shared/server';
import { DEFAULT_SETTINGS, type EngineId } from '../src/shared/settings';

const MODEL_ID = 'parakeet-tdt';
const HOST = 'domáci-pc';
const READY: AppStatus = { hotkeyLabel: '⌥Space', mode: 'smart', modelReady: true, pairingNeeded: false, serverRepairNeeded: false, permissionsOk: true, paused: false };
const ONLINE: ServerStatus = { kind: 'online', connectMs: 38, serverVersion: '0.2.4' };
const OFFLINE: ServerStatus = { kind: 'offline' };

type Scenario = { engineOrder: EngineId[]; localReady: boolean; server: ServerStatus | null; status: Partial<AppStatus>; statesLoaded?: boolean };

type HomeView = { message: string | null; actions: ReadinessAction[]; prepis: PathNode | undefined; header: string; summary: string; homeBadge: boolean };

function modelStates(ready: boolean): ModelState[] {
  return ready ? [{ id: MODEL_ID, status: 'ready', receivedBytes: 1, totalBytes: 1 }] : [];
}

function paired(status: ServerStatus): PairedServerView {
  return { host: HOST, endpoint: 'wss://domaci-pc:8443', deviceId: 'dev', deviceName: 'MacBook', pairedAt: '2026-11-01', serverFingerprint: 'a', deviceFingerprint: 'b', status };
}

function serverView(status: ServerStatus | null): ServerView {
  return { storage: 'available', server: status === null ? null : paired(status), pairing: { kind: 'idle' } };
}

function home(scenario: Scenario): HomeView {
  const status: AppStatus = { ...READY, ...scenario.status };
  const states = modelStates(scenario.localReady);
  const view = serverView(scenario.server);
  const capabilities = engineCapabilities(MODEL_ID, { states, statesLoaded: scenario.statesLoaded ?? true }, view);
  const issue = engineIssue({ status, engineOrder: scenario.engineOrder, capabilities, server: view.server });
  const content = bannerContent(status, issue);
  const route = transcriptionRoute({ status, engineOrder: scenario.engineOrder, server: view.server, localReady: isModelReady(states, MODEL_ID), modelName: 'Parakeet TDT', issue });
  const nodes = signalPathNodes({ status, settings: { ...DEFAULT_SETTINGS, engineOrder: scenario.engineOrder, localModelId: MODEL_ID }, permissions: null, route });
  return {
    message: content.kind === 'action' ? content.message : null,
    actions: content.kind === 'action' ? readinessActions(content) : [],
    prepis: nodes.find((node) => node.id === 'transcription'),
    header: pathHeader(status, issue).label,
    summary: readinessSummary(status, issue).label,
    homeBadge: railBadges(status, issue).home === 'err',
  };
}

function buttons(view: HomeView): Array<[string, boolean]> {
  return view.actions.map((action) => [action.label, action.primary]);
}

function overlayButtons(reason: EngineUnavailableReason, scenario: Scenario): OverlayAction[] {
  const capabilities = engineCapabilities(MODEL_ID, { states: modelStates(scenario.localReady), statesLoaded: true }, serverView(scenario.server));
  expect(capabilities).not.toBeNull();
  const error = readinessError(reason, { ...(capabilities ?? { localReady: false, serverReady: false }), serverOffline: scenario.server?.kind === 'offline' });
  return [error.alternative, error.action].filter((action): action is OverlayAction => action !== undefined);
}

const LOCAL_WITHOUT_MODEL_WITH_SERVER: Scenario = { engineOrder: ['local'], localReady: false, server: ONLINE, status: { modelReady: false } };
const LOCAL_WITHOUT_MODEL_WITH_OFFLINE_SERVER: Scenario = { engineOrder: ['local'], localReady: false, server: OFFLINE, status: { modelReady: false } };
const LOCAL_WITHOUT_MODEL_OR_SERVER: Scenario = { engineOrder: ['local'], localReady: false, server: null, status: { modelReady: false } };
const SERVER_UNPAIRED_WITH_MODEL: Scenario = { engineOrder: ['server'], localReady: true, server: null, status: { modelReady: false, pairingNeeded: true } };
const SERVER_UNPAIRED_WITHOUT_MODEL: Scenario = { engineOrder: ['server'], localReady: false, server: null, status: { modelReady: false, pairingNeeded: true } };
const SERVER_OFFLINE_WITH_MODEL: Scenario = { engineOrder: ['server'], localReady: true, server: OFFLINE, status: {} };
const SERVER_OFFLINE_WITHOUT_MODEL: Scenario = { engineOrder: ['server'], localReady: false, server: OFFLINE, status: {} };

describe('Home readiness fixes', () => {
  it('offers the paired server first and the model download second when the local model is missing', () => {
    const view = home(LOCAL_WITHOUT_MODEL_WITH_SERVER);

    expect(view.message).toBe('Lokálny model nie je stiahnutý.');
    expect(buttons(view)).toEqual([
      ['Stiahnuť model', false],
      [`Prepisovať na serveri ${HOST}`, true],
    ]);
    expect(view.actions.map((action) => action.command)).toEqual([
      { kind: 'navigate', target: { page: 'settings', section: 'local-model' } },
      { kind: 'prefer-engine', engine: 'server' },
    ]);
  });

  it('never offers a paired server that is offline and points to the Server page instead', () => {
    const view = home(LOCAL_WITHOUT_MODEL_WITH_OFFLINE_SERVER);

    expect(view.message).toBe('Lokálny model nie je stiahnutý.');
    expect(buttons(view)).toEqual([
      ['Otvoriť Server', false],
      ['Stiahnuť model', true],
    ]);
    expect(view.actions.map((action) => action.command)).toEqual([
      { kind: 'navigate', target: { page: 'server' } },
      { kind: 'navigate', target: { page: 'settings', section: 'local-model' } },
    ]);
  });

  it('offers the model download first and pairing second when no server is paired', () => {
    const view = home(LOCAL_WITHOUT_MODEL_OR_SERVER);

    expect(buttons(view)).toEqual([
      ['Spárovať server', false],
      ['Stiahnuť model', true],
    ]);
    expect(view.actions.map((action) => action.command)).toEqual([
      { kind: 'navigate', target: { page: 'server' } },
      { kind: 'navigate', target: { page: 'settings', section: 'local-model' } },
    ]);
  });

  it('offers local transcription when the server is not paired or offline and the local model is ready', () => {
    const unpaired = home(SERVER_UNPAIRED_WITH_MODEL);
    expect(unpaired.message).toBe('Server nie je spárovaný.');
    expect(buttons(unpaired)).toEqual([
      ['Spárovať server', false],
      ['Prepisovať lokálne', true],
    ]);
    expect(unpaired.actions.at(-1)?.command).toEqual({ kind: 'prefer-engine', engine: 'local' });

    const offline = home(SERVER_OFFLINE_WITH_MODEL);
    expect(offline.message).toBe('Server nie je dostupný.');
    expect(buttons(offline)).toEqual([['Prepisovať lokálne', true]]);
  });

  it('falls back to opening the right page when no engine can take over', () => {
    expect(buttons(home(SERVER_UNPAIRED_WITHOUT_MODEL))).toEqual([
      ['Stiahnuť model', false],
      ['Spárovať server', true],
    ]);
    expect(buttons(home(SERVER_OFFLINE_WITHOUT_MODEL))).toEqual([['Otvoriť Server', true]]);
  });

  it('keeps the plain page link until the engine capabilities are known', () => {
    const view = home({ ...LOCAL_WITHOUT_MODEL_WITH_SERVER, statesLoaded: false });

    expect(view.message).toBe('Lokálny model nie je stiahnutý.');
    expect(buttons(view)).toEqual([['Otvoriť nastavenia', true]]);
    expect(view.actions[0]?.command).toEqual({ kind: 'navigate', target: { page: 'settings', section: 'local-model' } });
  });

  it('marks the Prepis node and the whole path broken with the same problem', () => {
    expect(home(LOCAL_WITHOUT_MODEL_WITH_SERVER).prepis).toMatchObject({ state: 'err', value: 'Lokálne · model chýba', target: { page: 'settings', section: 'local-model' } });
    expect(home(SERVER_UNPAIRED_WITH_MODEL).prepis).toMatchObject({ state: 'err', value: 'Server nie je spárovaný', target: { page: 'server' } });

    const offline = home(SERVER_OFFLINE_WITH_MODEL);
    expect(offline.prepis).toMatchObject({ state: 'err', value: 'Server je offline', target: { page: 'server' } });
    expect(offline).toMatchObject({ header: 'signál sa prerušil', summary: 'Diktovanie nefunguje', homeBadge: true });
  });

  it('stays ready when a fallback engine carries the dictation', () => {
    const view = home({ engineOrder: ['server', 'local'], localReady: true, server: OFFLINE, status: {} });

    expect(view.message).toBeNull();
    expect(view.prepis).toMatchObject({ state: 'warn', meta: 'offline · záloha lokálne' });
    expect(view).toMatchObject({ header: 'signál prechádza', summary: 'Pripravené', homeBadge: false });
  });

  it('trusts the reported status for the model and pairing and adds only what it cannot know', () => {
    expect(home({ ...LOCAL_WITHOUT_MODEL_OR_SERVER, status: {} })).toMatchObject({ message: null, summary: 'Pripravené' });
    expect(home({ ...SERVER_OFFLINE_WITH_MODEL, status: {} }).message).toBe('Server nie je dostupný.');
    expect(buttons(home({ engineOrder: ['local'], localReady: true, server: null, status: { modelReady: false } }))).toEqual([['Otvoriť nastavenia', true]]);
  });

  it('asks for the hotkey and the server repair before the engine fixes', () => {
    expect(buttons(home({ ...LOCAL_WITHOUT_MODEL_WITH_SERVER, status: { modelReady: false, hotkeyLabel: null } }))).toEqual([['Otvoriť nastavenia', true]]);
    expect(home({ ...SERVER_OFFLINE_WITH_MODEL, status: { serverRepairNeeded: true } }).actions).toEqual([
      { id: 'open-server', label: 'Otvoriť Server', command: { kind: 'navigate', target: { page: 'server' } }, primary: true },
    ]);
  });

  it('offers the same fixes in the same order as the dictation overlay', () => {
    const cases: Array<[EngineUnavailableReason, Scenario]> = [
      ['no-model', LOCAL_WITHOUT_MODEL_WITH_SERVER],
      ['no-model', LOCAL_WITHOUT_MODEL_WITH_OFFLINE_SERVER],
      ['no-model', LOCAL_WITHOUT_MODEL_OR_SERVER],
      ['server-not-paired', SERVER_UNPAIRED_WITH_MODEL],
      ['server-not-paired', SERVER_UNPAIRED_WITHOUT_MODEL],
      ['server-offline', SERVER_OFFLINE_WITH_MODEL],
    ];

    for (const [reason, scenario] of cases) {
      expect(home(scenario).actions.map((action) => action.id)).toEqual(overlayButtons(reason, scenario));
    }
  });
});
