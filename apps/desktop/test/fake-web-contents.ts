import { EventEmitter } from 'node:events';
import type { HandlerDetails, WebContents, WindowOpenHandlerResponse } from 'electron';

type WindowOpenHandler = (details: HandlerDetails) => WindowOpenHandlerResponse;

export type NavigationEvent = { url: string; defaultPrevented: boolean; preventDefault: () => void };

export class FakeWebContents extends EventEmitter {
  private windowOpenHandler: WindowOpenHandler | null = null;

  setWindowOpenHandler(handler: WindowOpenHandler): void {
    this.windowOpenHandler = handler;
  }

  openWindow(url: string): WindowOpenHandlerResponse | null {
    if (this.windowOpenHandler === null) {
      return null;
    }
    return this.windowOpenHandler({ url, frameName: '', features: '', disposition: 'new-window', referrer: { url: '', policy: 'default' } });
  }

  navigate(url: string): NavigationEvent {
    const event: NavigationEvent = {
      url,
      defaultPrevented: false,
      preventDefault() {
        event.defaultPrevented = true;
      },
    };
    this.emit('will-navigate', event, url);
    return event;
  }

  asWebContents(): WebContents {
    return this as unknown as WebContents;
  }
}
