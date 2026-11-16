import type { CatalogEntry } from '@codevo-whisper/protocol';

export type FakeCatalog = { downloadsEnabled: boolean; models: readonly CatalogEntry[] };

type Answer = { status: number; body: unknown };

const MODEL_PATH = /^\/models\/([^/]+)(\/download|\/cancel)?$/;

const STATUS = (status: number, value: string): Answer => ({ status, body: { status: value } });

const ERROR = (status: number, value: string): Answer => ({ status, body: { error: value } });

export const FAKE_CATALOG_MODELS: readonly CatalogEntry[] = [
  { id: 'parakeet-ultra', name: 'Parakeet Ultra (F16)', family: 'parakeet', sizeBytes: 1_256_724_448, removable: false, state: 'installed', receivedBytes: null },
  { id: 'whisper-large-v3', name: 'Whisper Large v3 (F16)', family: 'whisper', sizeBytes: 3_107_236_640, removable: true, state: 'installed', receivedBytes: null },
  { id: 'whisper-large-v3-turbo', name: 'Whisper Large v3 Turbo (F16)', family: 'whisper', sizeBytes: 1_625_935_488, removable: true, state: 'missing', receivedBytes: null },
];

export class FakeModelCatalog {
  catalogRequests = 0;
  readonly operations: string[] = [];
  private readonly models: CatalogEntry[];
  private readonly inUse = new Set<string>();

  constructor(
    private readonly catalog: FakeCatalog,
    private readonly onAvailability: (id: string, available: boolean) => void,
  ) {
    this.models = catalog.models.map((model) => ({ ...model }));
  }

  entries(): CatalogEntry[] {
    return this.models.map((model) => ({ ...model }));
  }

  handle(method: string, pathname: string): Answer | null {
    if (method === 'GET' && pathname === '/catalog') {
      this.catalogRequests += 1;
      return { status: 200, body: { downloadsEnabled: this.catalog.downloadsEnabled, models: this.entries() } };
    }
    const match = MODEL_PATH.exec(pathname);
    const id = match?.[1];
    if (match === null || id === undefined) {
      return null;
    }
    const route = [method, match[2]].filter((part) => part !== undefined).join(' ');
    this.operations.push(`${route} ${id}`);
    return this.operate(route, id);
  }

  complete(id: string): void {
    this.update(id, { state: 'installed', receivedBytes: null });
    this.onAvailability(id, true);
  }

  fail(id: string): void {
    this.update(id, { state: 'failed', receivedBytes: null });
  }

  setInUse(id: string, inUse: boolean): void {
    if (inUse) {
      this.inUse.add(id);
      return;
    }
    this.inUse.delete(id);
  }

  private operate(route: string, id: string): Answer {
    const model = this.models.find((candidate) => candidate.id === id);
    if (model === undefined) {
      return ERROR(400, 'unknown model');
    }
    if (route === 'POST /cancel') {
      return this.cancel(model);
    }
    if (!this.catalog.downloadsEnabled) {
      return ERROR(403, 'downloads disabled');
    }
    if (route === 'POST /download') {
      return this.download(model);
    }
    if (route === 'DELETE') {
      return this.remove(model);
    }
    return ERROR(404, 'not found');
  }

  private download(model: CatalogEntry): Answer {
    if (model.state === 'installed') {
      return STATUS(200, 'installed');
    }
    const running = this.models.find((candidate) => candidate.state === 'downloading');
    if (running !== undefined && running.id !== model.id) {
      return ERROR(409, 'download busy');
    }
    this.update(model.id, { state: 'downloading', receivedBytes: 0 });
    return STATUS(202, 'started');
  }

  private remove(model: CatalogEntry): Answer {
    if (!model.removable) {
      return ERROR(409, 'model not removable');
    }
    if (model.state === 'downloading') {
      return ERROR(409, 'download busy');
    }
    if (model.state !== 'installed') {
      return STATUS(200, 'missing');
    }
    if (this.inUse.has(model.id)) {
      return ERROR(409, 'model in use');
    }
    this.update(model.id, { state: 'missing', receivedBytes: null });
    this.onAvailability(model.id, false);
    return STATUS(200, 'removed');
  }

  private cancel(model: CatalogEntry): Answer {
    if (model.state !== 'downloading') {
      return STATUS(200, 'idle');
    }
    this.update(model.id, { state: 'missing', receivedBytes: null });
    return STATUS(200, 'cancelled');
  }

  private update(id: string, fields: Pick<CatalogEntry, 'state' | 'receivedBytes'>): void {
    const index = this.models.findIndex((model) => model.id === id);
    const model = this.models[index];
    if (model === undefined) {
      return;
    }
    this.models[index] = { ...model, ...fields };
  }
}
