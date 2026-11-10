import { useEffect, useState } from 'react';
import { Glyph } from '../components/Glyph';

const COPIED_MS = 1500;

export function CommandBox({ command, label = 'Kopírovať' }: { command: string; label?: string }) {
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
    <div className="cmd">
      <code>{command}</code>
      <button type="button" className={copied ? 'tbtn ok' : 'tbtn'} onClick={copy} aria-live="polite">
        <Glyph name={copied ? 'check' : 'copy'} size="sm" />
        {copied ? 'Skopírované' : label}
      </button>
    </div>
  );
}
