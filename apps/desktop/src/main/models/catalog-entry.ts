import type { LanguageHint } from '../../shared/models';

export const LANGUAGE_HINTS = ['ignored', 'required', 'optional'] as const satisfies readonly LanguageHint[];

export const MODEL_ENGINES = ['transcribe.cpp'] as const;

export const MODEL_BACKENDS = ['metal', 'cpu', 'vulkan'] as const;

export const PLATFORM_KEYS = ['darwin-arm64', 'darwin-x64', 'linux-cpu', 'linux-vulkan'] as const;

export type ModelEngine = (typeof MODEL_ENGINES)[number];

export type ModelBackend = (typeof MODEL_BACKENDS)[number];

export type PlatformKey = (typeof PLATFORM_KEYS)[number];

export type CatalogDefault = { model: string; backend: ModelBackend };

export type CatalogDefaults = Readonly<Record<PlatformKey, CatalogDefault>>;

export type CatalogSource = { repo: string; revision: string; file: string };

export type CatalogEntry = {
  id: string;
  name: string;
  engine: ModelEngine;
  quantization: string;
  languages: readonly string[];
  languageHint: LanguageHint;
  sizeBytes: number;
  minRamBytes: number;
  license: string;
  licenseUrl: string;
  attribution: string;
  upstream: string;
  source: CatalogSource;
  sha256: string;
  roles: readonly string[];
  roleLabels: readonly string[];
};
