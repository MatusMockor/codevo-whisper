import { useEffect, useState } from 'react';
import { CheckIcon, CopyIcon } from '../components/Icons';

const COPIED_MS = 1500;

export function CommandBox({ command, label = 'Kopírovať príkaz' }: { command: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) {
      return;
    }
    const timer = setTimeout(() => setCopied(false), COPIED_MS);
    return () => clearTimeout(timer);
  }, [copied]);

  function copy(): void {
    navigator.clipboard.writeText(command).then(
      () => setCopied(true),
      (error: unknown) => console.error('Copying the command failed', error),
    );
  }

  return (
    <div className="term">
      <code>
        <span className="pr">$</span> {command}
      </code>
      <button type="button" className="btn" onClick={copy} aria-live="polite">
        {copied ? <CheckIcon /> : <CopyIcon />}
        {copied ? 'Skopírované' : label}
      </button>
    </div>
  );
}
