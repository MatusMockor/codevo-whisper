import { useEffect, useId, useRef, useState } from 'react';
import { Switch } from '../components/Switch';

type ServerToggleProps = { connected: boolean; localReady: boolean };

const TOGGLE_FAILED = 'Server sa nepodarilo pripojiť ani odpojiť. Skúste to znova.';

type DisconnectConfirmProps = { onCancel: () => void; onConfirm: () => void };

function DisconnectConfirm({ onCancel, onConfirm }: DisconnectConfirmProps) {
  const keep = useRef<HTMLButtonElement>(null);
  const warningId = useId();

  useEffect(() => {
    keep.current?.focus();
  }, []);

  return (
    <div
      className="confirm srv-off-confirm"
      role="alertdialog"
      aria-label="Odpojiť server"
      aria-describedby={warningId}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') {
          return;
        }
        event.preventDefault();
        onCancel();
      }}
    >
      <p id={warningId}>
        <b>Lokálny model nemáte stiahnutý, takže po odpojení servera diktovanie nebude fungovať.</b> Párovanie zostane uložené a server kedykoľvek znova pripojíte bez nového
        párovania. Model si stiahnete nižšie v časti Lokálny model.
      </p>
      <div className="row-btns">
        <button ref={keep} type="button" className="btn ghost" onClick={onCancel}>
          Nechať pripojený
        </button>
        <button type="button" className="btn danger" onClick={onConfirm}>
          Odpojiť server
        </button>
      </div>
    </div>
  );
}

export function useServerToggle({ connected, localReady }: ServerToggleProps) {
  const [pending, setPending] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(false);

  useEffect(() => {
    if (!returnFocus.current || pending || confirming) {
      return;
    }
    returnFocus.current = false;
    toggleRef.current?.focus();
  }, [pending, confirming]);

  function apply(next: boolean): void {
    setFailure(null);
    setPending(true);
    window.codevo
      .setServerEnabled(next)
      .catch((error: unknown) => {
        console.error('Connecting or disconnecting the server failed', error);
        setFailure(TOGGLE_FAILED);
      })
      .finally(() => setPending(false));
  }

  function dismiss(): void {
    returnFocus.current = true;
    setConfirming(false);
  }

  function confirmDisconnect(): void {
    dismiss();
    apply(false);
  }

  function toggle(): void {
    if (!connected) {
      returnFocus.current = true;
      apply(true);
      return;
    }
    if (!localReady) {
      setConfirming(true);
      return;
    }
    returnFocus.current = true;
    apply(false);
  }

  const control = <Switch ref={toggleRef} label="Pripojenie k serveru" checked={connected} disabled={pending} onChange={toggle} />;
  const notice = (
    <>
      {confirming && <DisconnectConfirm onCancel={dismiss} onConfirm={confirmDisconnect} />}
      {failure !== null && (
        <p className="save-error" role="alert">
          {failure}
        </p>
      )}
    </>
  );
  return { control, notice };
}
