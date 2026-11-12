import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { edgeScrollStep, exceedsThreshold, scrollsVertically, visibleSpan, type Point } from './pointer-drag';

export type ActiveDrag<S, T> = { source: S; target: T; pointer: Point; grab: Point; width: number };

export type PointerDragOptions<S, T> = { resolve: (point: Point) => T; drop: (source: S, target: T) => void };

export type PointerDrag<S, T> = {
  active: ActiveDrag<S, T> | null;
  begin: (event: ReactPointerEvent<HTMLElement>, source: S) => void;
  allowsClick: (click: { detail: number }) => boolean;
};

type Press<S> = { source: S; pointerId: number; start: Point; pointer: Point; grab: Point; width: number; dragging: boolean };

type Scroller = { element: Element; span: () => { top: number; bottom: number } };

function scrollerOf(element: Element): Scroller {
  const page = document.scrollingElement ?? document.documentElement;
  for (let node = element.parentElement; node !== null && node !== page; node = node.parentElement) {
    if (scrollsVertically(getComputedStyle(node).overflowY, node.scrollHeight, node.clientHeight)) {
      const scrolling = node;
      return { element: scrolling, span: () => visibleSpan(scrolling.getBoundingClientRect(), window.innerHeight) };
    }
  }
  return { element: page, span: () => visibleSpan(null, window.innerHeight) };
}

function pointOf(event: PointerEvent): Point {
  return { x: event.clientX, y: event.clientY };
}

export function usePointerDrag<S, T>(options: PointerDragOptions<S, T>): PointerDrag<S, T> {
  const [active, setActive] = useState<ActiveDrag<S, T> | null>(null);
  const latest = useRef(options);
  const press = useRef<Press<S> | null>(null);
  const release = useRef<(() => void) | null>(null);
  const suppressClick = useRef(false);

  useEffect(() => {
    latest.current = options;
  });

  useEffect(() => () => release.current?.(), []);

  function finish(): void {
    const stop = release.current;
    release.current = null;
    press.current = null;
    stop?.();
    setActive(null);
  }

  function follow(current: Press<S>, point: Point): void {
    setActive({ source: current.source, target: latest.current.resolve(point), pointer: point, grab: current.grab, width: current.width });
  }

  function begin(event: ReactPointerEvent<HTMLElement>, source: S): void {
    if (event.button !== 0 || !event.isPrimary || press.current !== null) {
      return;
    }
    suppressClick.current = false;
    const element = event.currentTarget;
    const box = element.getBoundingClientRect();
    const start = { x: event.clientX, y: event.clientY };
    const pointerId = event.pointerId;
    press.current = { source, pointerId, start, pointer: start, grab: { x: start.x - box.left, y: start.y - box.top }, width: box.width, dragging: false };
    element.setPointerCapture(pointerId);
    const scroller = scrollerOf(element);
    let frame: number | null = null;

    const scroll = (): void => {
      const current = press.current;
      if (current === null || !current.dragging) {
        frame = null;
        return;
      }
      const step = edgeScrollStep(current.pointer.y, scroller.span());
      const before = scroller.element.scrollTop;
      scroller.element.scrollTop = before + step;
      if (scroller.element.scrollTop !== before) {
        follow(current, current.pointer);
      }
      frame = requestAnimationFrame(scroll);
    };

    const move = (moved: PointerEvent): void => {
      const current = press.current;
      if (current === null || moved.pointerId !== pointerId) {
        return;
      }
      const point = pointOf(moved);
      current.pointer = point;
      if (!current.dragging && !exceedsThreshold(current.start, point)) {
        return;
      }
      current.dragging = true;
      moved.preventDefault();
      follow(current, point);
      frame ??= requestAnimationFrame(scroll);
    };
    const up = (lifted: PointerEvent): void => {
      const current = press.current;
      if (current === null || lifted.pointerId !== pointerId) {
        return;
      }
      if (current.dragging) {
        suppressClick.current = true;
        latest.current.drop(current.source, latest.current.resolve(pointOf(lifted)));
      }
      finish();
    };
    const cancel = (cancelled: PointerEvent): void => {
      if (cancelled.pointerId !== pointerId) {
        return;
      }
      suppressClick.current = press.current?.dragging === true;
      finish();
    };
    const escape = (key: KeyboardEvent): void => {
      if (key.key !== 'Escape' || press.current?.dragging !== true) {
        return;
      }
      key.preventDefault();
      key.stopPropagation();
      suppressClick.current = true;
      finish();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('keydown', escape, true);
    release.current = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('keydown', escape, true);
      if (frame !== null) {
        cancelAnimationFrame(frame);
      }
      if (element.hasPointerCapture(pointerId)) {
        element.releasePointerCapture(pointerId);
      }
    };
  }

  return { active, begin, allowsClick: (click) => click.detail === 0 || !suppressClick.current };
}
