'use client';

import Link from 'next/link';
import DarkModeToggle from './DarkModeToggle';

export default function ArticleNav({ backHref = '/' }: { backHref?: string }) {
  return (
    <nav
      className="sticky top-0 z-[80] flex items-center justify-between"
      style={{
        height: '48px',
        background: 'var(--paper)',
        borderBottom: '2px solid var(--ink)',
        padding: '0 16px',
      }}
    >
      <div className="flex items-center gap-3">
        <Link
          href={backHref}
          className="font-ui uppercase flex items-center gap-1.5 transition-colors"
          style={{
            fontSize: '11px',
            fontWeight: 600,
            letterSpacing: '0.7px',
            color: 'var(--ink-3)',
          }}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 20 20"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            aria-hidden="true"
          >
            <path
              d="M12 4L6 10L12 16"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="square"
              strokeLinejoin="miter"
            />
          </svg>
          Back to Feed
        </Link>
        <span
          aria-hidden="true"
          style={{
            display: 'inline-block',
            width: '5px',
            height: '5px',
            borderRadius: '50%',
            background: 'var(--red)',
          }}
        />
        <span
          className="font-headline"
          style={{ fontSize: '22px', fontWeight: 900, color: 'var(--ink)' }}
        >
          CLARION
        </span>
      </div>
      <DarkModeToggle compact />
    </nav>
  );
}
