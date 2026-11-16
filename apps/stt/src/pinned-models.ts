export type PinnedFile = { file: string; name: string; repo: string; revision: string; sha256: string; size: number };

const HUGGING_FACE = 'https://huggingface.co';

const PARAKEET_REPO = { repo: 'handy-computer/parakeet-ultra-gguf', revision: 'a1539be1b849ea7463b88343e5277b373d0c4ea9' };
const WHISPER_REPO = { repo: 'handy-computer/whisper-large-v3-gguf', revision: '274ad1d1cf680b7ee53cc70f78461394cd3a344b' };
const WHISPER_TURBO_REPO = { repo: 'handy-computer/whisper-large-v3-turbo-gguf', revision: '18ada752005f5fddef499256f9a458d0b37a203a' };

export const PARAKEET_ULTRA_F16: PinnedFile = {
  ...PARAKEET_REPO,
  file: 'parakeet-ultra-F16.gguf',
  name: 'Parakeet Ultra (F16)',
  sha256: 'cd97f94fa50a034a9019a47e2ed7a2de3963eed8316d1df4de9efdccca6fe78d',
  size: 1_256_724_448,
};

export const PARAKEET_ULTRA_Q8: PinnedFile = {
  ...PARAKEET_REPO,
  file: 'parakeet-ultra-Q8_0.gguf',
  name: 'Parakeet Ultra (Q8)',
  sha256: '007a59761e9258779f189df396b50d12b83bb5b79e66df4b955c230d2f2a0a59',
  size: 740_363_168,
};

export const WHISPER_LARGE_V3_F16: PinnedFile = {
  ...WHISPER_REPO,
  file: 'whisper-large-v3-F16.gguf',
  name: 'Whisper Large v3 (F16)',
  sha256: 'e633ab1d74b0e98f4f57daedaee34291297dbbf01389bda3d890766600c1c584',
  size: 3_107_236_640,
};

export const WHISPER_LARGE_V3_Q8: PinnedFile = {
  ...WHISPER_REPO,
  file: 'whisper-large-v3-Q8_0.gguf',
  name: 'Whisper Large v3 (Q8)',
  sha256: '2fa1a5f179f8a511a53e2108db270aa4af3ce08cd976af4180e2854666bb4ba3',
  size: 1_668_741_440,
};

export const WHISPER_LARGE_V3_TURBO_F16: PinnedFile = {
  ...WHISPER_TURBO_REPO,
  file: 'whisper-large-v3-turbo-F16.gguf',
  name: 'Whisper Large v3 Turbo (F16)',
  sha256: 'c8506ddfa3d4eb9279170d722a75422db00dbdbd7618531bbb81926e0598eb8f',
  size: 1_625_935_488,
};

export const WHISPER_LARGE_V3_TURBO_Q8: PinnedFile = {
  ...WHISPER_TURBO_REPO,
  file: 'whisper-large-v3-turbo-Q8_0.gguf',
  name: 'Whisper Large v3 Turbo (Q8)',
  sha256: '257aa7ec9121c22c167d5e2c49e3e76b4ba0e6e27ebc13074eba0a80f8190220',
  size: 886_381_728,
};

export const CANARY_1B_V2_Q8: PinnedFile = {
  repo: 'handy-computer/canary-1b-v2-gguf',
  revision: '692af661b140183b60e44f55ad03c59e1e77d078',
  file: 'canary-1b-v2-Q8_0.gguf',
  name: 'Canary 1B v2 (Q8)',
  sha256: '224f83d1bc487b3303b495a7d6874912fdece93de19d1a04b550829c30a5d289',
  size: 1_144_290_016,
};

export const VOXLINGUA107_Q8: PinnedFile = {
  repo: 'handy-computer/lang-id-voxlingua107-ecapa-gguf',
  revision: 'e59f0f3847e77723b7d58447ef9456fa0c7e9436',
  file: 'lang-id-voxlingua107-ecapa-Q8_0.gguf',
  name: 'VoxLingua107 (rozpoznanie jazyka)',
  sha256: '063e6cb0af3d53085fc7d68356dfde5ecee2ffa7bc79855f7e4ff930081bfe3a',
  size: 26_693_632,
};

export const PINNED_FILES: readonly PinnedFile[] = [
  PARAKEET_ULTRA_F16,
  PARAKEET_ULTRA_Q8,
  CANARY_1B_V2_Q8,
  VOXLINGUA107_Q8,
  WHISPER_LARGE_V3_F16,
  WHISPER_LARGE_V3_Q8,
  WHISPER_LARGE_V3_TURBO_F16,
  WHISPER_LARGE_V3_TURBO_Q8,
];

export function pinnedUrl(pinned: PinnedFile): string {
  return `${HUGGING_FACE}/${pinned.repo}/resolve/${pinned.revision}/${pinned.file}`;
}
