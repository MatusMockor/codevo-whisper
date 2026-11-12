import { resolve } from 'node:path';

export type ModelRole = 'verbatim' | 'conditioned' | 'language-id';

export type ModelFile = { role: ModelRole; url: string; sha256: string; size: number; target: string };

export type ModelTargets = { model: string; conditionedModel: string; lidModel: string };

const HUGGING_FACE = 'https://huggingface.co';

function huggingFaceUrl(repo: string, revision: string, file: string): string {
  return `${HUGGING_FACE}/${repo}/resolve/${revision}/${file}`;
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
      {
        role: 'verbatim',
        url: huggingFaceUrl('handy-computer/parakeet-ultra-gguf', 'a1539be1b849ea7463b88343e5277b373d0c4ea9', 'parakeet-ultra-F16.gguf'),
        sha256: 'cd97f94fa50a034a9019a47e2ed7a2de3963eed8316d1df4de9efdccca6fe78d',
        size: 1_256_724_448,
        target: targets.model,
      },
      {
        role: 'conditioned',
        url: huggingFaceUrl('handy-computer/canary-1b-v2-gguf', '692af661b140183b60e44f55ad03c59e1e77d078', 'canary-1b-v2-Q8_0.gguf'),
        sha256: '224f83d1bc487b3303b495a7d6874912fdece93de19d1a04b550829c30a5d289',
        size: 1_144_290_016,
        target: targets.conditionedModel,
      },
      {
        role: 'language-id',
        url: huggingFaceUrl('handy-computer/lang-id-voxlingua107-ecapa-gguf', 'e59f0f3847e77723b7d58447ef9456fa0c7e9436', 'lang-id-voxlingua107-ecapa-Q8_0.gguf'),
        sha256: '063e6cb0af3d53085fc7d68356dfde5ecee2ffa7bc79855f7e4ff930081bfe3a',
        size: 26_693_632,
        target: targets.lidModel,
      },
    ]);
  }

  extraBytes(): number {
    return this.files.filter((file) => file.role !== 'verbatim').reduce((total, file) => total + file.size, 0);
  }
}
