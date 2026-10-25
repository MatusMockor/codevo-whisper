import { useEffect, useState } from 'react';
import type { OverlayState } from '../../shared/overlay-contract';
import { nextLevelHistory } from './level-history';
import { Overlay } from './Overlay';

type View = { state: OverlayState; levels: number[] };

const INITIAL: View = { state: { kind: 'hidden' }, levels: [] };

export function OverlayApp() {
  const [view, setView] = useState<View>(INITIAL);

  useEffect(() => {
    return window.codevoOverlay.onState((state) => {
      setView((previous) => ({ state, levels: nextLevelHistory(previous.levels, state) }));
    });
  }, []);

  return <Overlay state={view.state} levels={view.levels} onAction={(action) => window.codevoOverlay.act(action)} />;
}
