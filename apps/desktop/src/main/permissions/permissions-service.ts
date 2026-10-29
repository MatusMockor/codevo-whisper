import type { InputHelper, PermissionKind as HelperPermissionKind, Permissions } from '../helper/input-helper';
import { Listeners } from '../helper/listeners';
import type { Logger } from '../logging/logger';
import type { InputPermissionKind, MicrophonePermission, PermissionKind, PermissionsStatus } from '../../shared/permissions';
import type { AskedPermissions } from './asked-permissions-store';

export interface MicrophoneAccess {
  status(): string;
  ask(): Promise<boolean>;
}

export type OpenUrl = (url: string) => Promise<void>;

export type PermissionsChange = { next: PermissionsStatus; previous: PermissionsStatus | null };

export type PermissionsDeps = {
  helper: Pick<InputHelper, 'permissions' | 'requestPermission'>;
  microphone: MicrophoneAccess;
  links: Readonly<Record<PermissionKind, string>>;
  openUrl: OpenUrl;
  asked: AskedPermissions;
  logger: Logger;
  inputReady?: Promise<void> | undefined;
  platform?: NodeJS.Platform;
};

const NO_INPUT_PERMISSIONS: Permissions = { listen: false, post: false, accessibility: false };

const HELPER_PERMISSIONS: Readonly<Record<InputPermissionKind, HelperPermissionKind>> = Object.freeze({
  'input-monitoring': 'listen',
  accessibility: 'accessibility',
});

const DENIED_MEDIA_STATUSES: ReadonlySet<string> = new Set(['denied', 'restricted']);

function microphonePermission(mediaStatus: string): MicrophonePermission {
  if (mediaStatus === 'granted') {
    return 'granted';
  }
  return DENIED_MEDIA_STATUSES.has(mediaStatus) ? 'denied' : 'not-determined';
}

function sameStatus(a: PermissionsStatus | null, b: PermissionsStatus): boolean {
  return a !== null && a.microphone === b.microphone && a.inputMonitoring === b.inputMonitoring && a.accessibility === b.accessibility;
}

export class PermissionsService {
  private readonly changes: Listeners<PermissionsChange>;
  private readonly reads: Listeners<PermissionsStatus>;
  private last: PermissionsStatus | null = null;

  constructor(private readonly deps: PermissionsDeps) {
    this.changes = new Listeners(deps.logger, 'A permissions listener failed');
    this.reads = new Listeners(deps.logger, 'A permissions read listener failed');
  }

  async status(): Promise<PermissionsStatus> {
    await (this.deps.inputReady ?? Promise.resolve());
    const input = await this.deps.helper.permissions().catch((error: unknown) => {
      this.deps.logger.error('The input permissions could not be read', error);
      return NO_INPUT_PERMISSIONS;
    });
    const next = { microphone: microphonePermission(this.deps.microphone.status()), inputMonitoring: input.listen, accessibility: input.accessibility, ...(this.deps.platform === 'linux' ? { platform: 'linux' as const } : {}) };
    this.remember(next);
    this.reads.emit(next);
    return next;
  }

  async request(kind: PermissionKind): Promise<void> {
    if (kind === 'microphone') {
      await this.deps.microphone.ask();
      return;
    }
    await this.deps.helper.requestPermission(HELPER_PERMISSIONS[kind]);
    await this.deps.asked.remember(kind);
  }

  asked(): Promise<InputPermissionKind[]> {
    return this.deps.asked.asked();
  }

  openSettings(kind: PermissionKind): Promise<void> {
    return this.deps.openUrl(this.deps.links[kind]);
  }

  onChange(listener: (next: PermissionsStatus, previous: PermissionsStatus | null) => void): () => void {
    return this.changes.add(({ next, previous }) => listener(next, previous));
  }

  onRead(listener: (status: PermissionsStatus) => void): () => void {
    return this.reads.add(listener);
  }

  private remember(next: PermissionsStatus): void {
    const previous = this.last;
    if (sameStatus(previous, next)) {
      return;
    }
    this.last = next;
    this.changes.emit({ next, previous });
  }
}
