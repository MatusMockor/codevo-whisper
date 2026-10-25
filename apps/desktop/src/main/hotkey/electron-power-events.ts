import { powerMonitor } from 'electron';
import type { PowerEvent, PowerEvents } from './power-events';

export const electronPowerEvents: PowerEvents = Object.freeze({
  on(event: PowerEvent, listener: () => void): () => void {
    const emitter: NodeJS.EventEmitter = powerMonitor;
    emitter.on(event, listener);
    return () => {
      emitter.off(event, listener);
    };
  },
});
