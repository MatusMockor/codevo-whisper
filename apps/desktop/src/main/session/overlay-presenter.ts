import type { OverlayState } from '../../shared/overlay-contract';

export const RESULT_MS = 1200;
export const NOTICE_MS = 4000;

const HIDDEN: OverlayState = { kind: 'hidden' };

export function holdMs(state: OverlayState): number {
  return state.kind === 'blocked' || state.kind === 'error' ? NOTICE_MS : RESULT_MS;
}

export class OverlayPresenter {
  private owner: object | null = null;
  private timer: NodeJS.Timeout | null = null;
  private closed = false;

  constructor(private readonly render: (state: OverlayState) => void) {}

  owns(owner: object): boolean {
    return !this.closed && this.owner === owner;
  }

  claim(owner: object): void {
    this.clearTimer();
    this.owner = owner;
  }

  show(owner: object, state: OverlayState): void {
    if (!this.mayShow(owner)) {
      return;
    }
    this.claim(owner);
    this.render(state);
  }

  flash(owner: object, state: OverlayState): void {
    if (!this.mayShow(owner)) {
      return;
    }
    this.show(owner, state);
    this.timer = setTimeout(() => this.hide(owner), holdMs(state));
  }

  hide(owner: object): void {
    if (this.closed || this.owner !== owner) {
      return;
    }
    this.clearTimer();
    this.owner = null;
    this.render(HIDDEN);
  }

  dispose(): void {
    this.clearTimer();
    this.owner = null;
    this.closed = true;
  }

  private mayShow(owner: object): boolean {
    return !this.closed && (this.owner === null || this.owner === owner);
  }

  private clearTimer(): void {
    if (this.timer === null) {
      return;
    }
    clearTimeout(this.timer);
    this.timer = null;
  }
}
