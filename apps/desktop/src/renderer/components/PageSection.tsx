import { useId, type ReactNode } from 'react';
import type { SectionId } from '../../shared/section-focus';

type PageSectionProps = { index: string; title: string; hint: string; section: SectionId; children: ReactNode };

export function PageSection({ index, title, hint, section, children }: PageSectionProps) {
  const id = useId();
  return (
    <section className="page-sec" aria-labelledby={id} data-section={section}>
      <header className="sec-h">
        <span className="n" aria-hidden="true">
          {index}
        </span>
        <h2 id={id} tabIndex={-1}>
          {title}
        </h2>
        <p>{hint}</p>
      </header>
      {children}
    </section>
  );
}
