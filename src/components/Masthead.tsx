'use client';

function formatToday(): string {
  return new Date().toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

export default function Masthead() {
  const today = formatToday();
  return (
    <header
      className="w-full text-center"
      style={{ borderTop: '4px solid var(--red)', background: 'var(--paper)' }}
    >
      <div className="px-4 pt-7 pb-4 sm:pt-9">
        <h1
          className="font-headline"
          style={{
            fontWeight: 900,
            fontSize: 'clamp(52px, 9vw, 100px)',
            letterSpacing: '-3px',
            lineHeight: 0.95,
            color: 'var(--ink)',
          }}
        >
          CLARION
        </h1>
      </div>
      <div
        className="flex flex-col gap-1 px-4 py-1.5 sm:flex-row sm:items-center sm:justify-between"
        style={{
          borderTop: '1px solid var(--border)',
          borderBottom: '1px solid var(--border)',
          color: 'var(--ink-3)',
        }}
      >
        <span
          className="font-ui uppercase"
          style={{ fontSize: '11px', letterSpacing: '0.5px' }}
        >
          {today}
        </span>
        <span
          className="font-headline italic"
          style={{ fontSize: '13px', color: 'var(--ink-2)' }}
        >
          Truth, Clearly Told
        </span>
        <span
          className="font-ui uppercase"
          style={{ fontSize: '11px', letterSpacing: '0.5px' }}
        >
          Vol. CXLII · No. 49,123 · Late Edition
        </span>
      </div>
    </header>
  );
}
