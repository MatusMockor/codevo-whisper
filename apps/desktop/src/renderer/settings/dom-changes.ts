import type { Subscribe } from './await-reveal';

const INTERRUPTING_EVENTS = ['pointerdown', 'keydown'] as const;

export function domChanges(root: Node): Subscribe {
  return (listener) => {
    const observer = new MutationObserver(listener);
    observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden'] });
    return () => observer.disconnect();
  };
}

export function userInteractions(target: EventTarget): Subscribe {
  return (listener) => {
    INTERRUPTING_EVENTS.forEach((type) => target.addEventListener(type, listener, { capture: true }));
    return () => INTERRUPTING_EVENTS.forEach((type) => target.removeEventListener(type, listener, { capture: true }));
  };
}
