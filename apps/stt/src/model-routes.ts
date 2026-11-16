import type { IncomingMessage, ServerResponse } from 'node:http';
import type { CancelOutcome, DownloadOutcome, ModelManagement, RemoveOutcome } from './model-management';

type Outcome = DownloadOutcome | RemoveOutcome | CancelOutcome;

type Answer = { status: number; body: { status: string } | { error: string } };

type Respond = (response: ServerResponse, status: number, body: object) => void;

type Operation = (management: ModelManagement, id: string) => Promise<Outcome>;

const ANSWERS: Readonly<Record<Outcome, Answer>> = {
  started: { status: 202, body: { status: 'started' } },
  installed: { status: 200, body: { status: 'installed' } },
  removed: { status: 200, body: { status: 'removed' } },
  missing: { status: 200, body: { status: 'missing' } },
  cancelled: { status: 200, body: { status: 'cancelled' } },
  idle: { status: 200, body: { status: 'idle' } },
  unknown_model: { status: 400, body: { error: 'unknown model' } },
  downloads_disabled: { status: 403, body: { error: 'downloads disabled' } },
  download_busy: { status: 409, body: { error: 'download busy' } },
  model_not_removable: { status: 409, body: { error: 'model not removable' } },
  model_in_use: { status: 409, body: { error: 'model in use' } },
  insufficient_space: { status: 507, body: { error: 'insufficient space' } },
};

const MODEL_PATH = /^\/models\/([a-z0-9]+(?:[.-][a-z0-9]+)*)(\/download|\/cancel)?$/;

const OPERATIONS: ReadonlyMap<string, Operation> = new Map<string, Operation>([
  ['POST /download', (management, id) => management.download(id)],
  ['POST /cancel', (management, id) => management.cancel(id)],
  ['DELETE', (management, id) => management.remove(id)],
]);

export class ModelRoutes {
  constructor(
    private readonly management: ModelManagement,
    private readonly respond: Respond,
  ) {}

  handles(request: IncomingMessage, url: URL): boolean {
    if (url.pathname === '/catalog') {
      return request.method === 'GET';
    }
    return this.operationFor(request, url) !== null;
  }

  async handle(request: IncomingMessage, response: ServerResponse, url: URL): Promise<void> {
    request.resume();
    if (url.pathname === '/catalog') {
      this.respond(response, 200, this.management.report());
      return;
    }
    const operation = this.operationFor(request, url);
    const id = MODEL_PATH.exec(url.pathname)?.[1];
    if (operation === null || id === undefined) {
      this.respond(response, 404, { error: 'not found' });
      return;
    }
    const answer = ANSWERS[await operation(this.management, id)];
    this.respond(response, answer.status, answer.body);
  }

  private operationFor(request: IncomingMessage, url: URL): Operation | null {
    const match = MODEL_PATH.exec(url.pathname);
    if (match === null || match[1] === undefined || match[1].length > 64) {
      return null;
    }
    const route = [request.method ?? '', match[2]].filter((part) => part !== undefined).join(' ');
    return OPERATIONS.get(route) ?? null;
  }
}
