import { writeFileAtomic } from '../fs/atomic-write';
import { readOptionalFile } from '../fs/read-optional-file';
import type { Logger } from '../logging/logger';
import { isPlainRecord } from '../settings/settings-fields';
import { INPUT_PERMISSION_KINDS, isInputPermissionKind, type InputPermissionKind } from '../../shared/permissions';

export const ASKED_PERMISSIONS_FILE_VERSION = 1;

export interface AskedPermissions {
  asked(): Promise<InputPermissionKind[]>;
  remember(kind: InputPermissionKind): Promise<void>;
}

function inOrder(kinds: ReadonlySet<InputPermissionKind>): InputPermissionKind[] {
  return INPUT_PERMISSION_KINDS.filter((kind) => kinds.has(kind));
}

export function parseAskedPermissions(text: string): InputPermissionKind[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  if (!isPlainRecord(parsed) || parsed['version'] !== ASKED_PERMISSIONS_FILE_VERSION || !Array.isArray(parsed['asked'])) {
    return [];
  }
  const asked: unknown[] = parsed['asked'];
  if (!asked.every(isInputPermissionKind)) {
    return [];
  }
  return inOrder(new Set(asked));
}

export function serializeAskedPermissions(kinds: ReadonlySet<InputPermissionKind>): string {
  return `${JSON.stringify({ version: ASKED_PERMISSIONS_FILE_VERSION, asked: inOrder(kinds) }, null, 2)}\n`;
}

export class AskedPermissionsStore implements AskedPermissions {
  private known: Promise<ReadonlySet<InputPermissionKind>> | null = null;
  private pending: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly file: string,
    private readonly logger: Logger,
  ) {}

  async asked(): Promise<InputPermissionKind[]> {
    return inOrder(await this.current());
  }

  remember(kind: InputPermissionKind): Promise<void> {
    const run = this.pending.then(() => this.add(kind));
    this.pending = run.catch(() => undefined);
    return run;
  }

  private current(): Promise<ReadonlySet<InputPermissionKind>> {
    this.known ??= this.read();
    return this.known;
  }

  private async read(): Promise<ReadonlySet<InputPermissionKind>> {
    try {
      const text = await readOptionalFile(this.file);
      return new Set(text === null ? [] : parseAskedPermissions(text));
    } catch (error) {
      this.logger.error('The asked permissions could not be read', error);
      return new Set();
    }
  }

  private async add(kind: InputPermissionKind): Promise<void> {
    const known = await this.current();
    if (known.has(kind)) {
      return;
    }
    const next: ReadonlySet<InputPermissionKind> = new Set([...known, kind]);
    this.known = Promise.resolve(next);
    await writeFileAtomic(this.file, serializeAskedPermissions(next)).catch((error: unknown) => {
      this.logger.error('The asked permissions could not be saved', error);
    });
  }
}
