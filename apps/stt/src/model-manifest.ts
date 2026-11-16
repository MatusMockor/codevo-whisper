import { resolve } from 'node:path';
import { CANARY_1B_V2_Q8, PARAKEET_ULTRA_F16, pinnedUrl, VOXLINGUA107_Q8, WHISPER_LARGE_V3_F16, type PinnedFile } from './pinned-models';

export type ModelRole = 'verbatim' | 'conditioned' | 'language-id' | 'selectable';

export type ModelFile = { role: ModelRole; url: string; sha256: string; size: number; target: string };

export type ModelTargets = { model: string; conditionedModel: string; lidModel: string; whisperModel: string };

function manifestFile(role: ModelRole, pinned: PinnedFile, target: string): ModelFile {
  return { role, url: pinnedUrl(pinned), sha256: pinned.sha256, size: pinned.size, target };
}

function conflictingTarget(files: readonly ModelFile[]): string | null {
  const roles = new Map<string, ModelRole>();
  for (const file of files) {
    const target = resolve(file.target);
    const owner = roles.get(target);
    if (owner !== undefined) {
      return `model targets must be unique: ${target} is the target of both ${owner} and ${file.role}`;
    }
    roles.set(target, file.role);
  }
  return null;
}

export class ServerModelManifest {
  constructor(readonly files: readonly ModelFile[]) {
    const conflict = conflictingTarget(files);
    if (conflict !== null) {
      throw new RangeError(conflict);
    }
  }

  static pinned(targets: ModelTargets): ServerModelManifest {
    return new ServerModelManifest([
      manifestFile('verbatim', PARAKEET_ULTRA_F16, targets.model),
      manifestFile('conditioned', CANARY_1B_V2_Q8, targets.conditionedModel),
      manifestFile('language-id', VOXLINGUA107_Q8, targets.lidModel),
      manifestFile('selectable', WHISPER_LARGE_V3_F16, targets.whisperModel),
    ]);
  }

  extraBytes(): number {
    return this.files.filter((file) => file.role !== 'verbatim').reduce((total, file) => total + file.size, 0);
  }
}
