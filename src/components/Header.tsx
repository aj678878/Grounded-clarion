'use client';

import Link from 'next/link';

interface HeaderProps {
  /** If set, renders a back-arrow link to the given path. */
  backHref?: string;
  backLabel?: string;
}

export default function Header({ backHref, backLabel }: HeaderProps) {
  return (
    <header className="sticky top-0 z-30 border-b border-gray-200 bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/80">
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-4 px-4 sm:px-6">
        {backHref && (
          <Link
            href={backHref}
            className="flex items-center gap-1 text-sm font-body text-gray-500 hover:text-gray-900 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 rounded"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-4 w-4"
              viewBox="0 0 20 20"
              fill="currentColor"
            >
              <path
                fillRule="evenodd"
                d="M9.707 16.707a1 1 0 01-1.414 0l-6-6a1 1 0 010-1.414l6-6a1 1 0 011.414 1.414L5.414 9H17a1 1 0 110 2H5.414l4.293 4.293a1 1 0 010 1.414z"
                clipRule="evenodd"
              />
            </svg>
            <span>{backLabel ?? 'Back'}</span>
          </Link>
        )}

        <Link href="/" className="flex items-center gap-2">
          <h1 className="font-headline text-xl font-bold tracking-tight text-primary">
            Grounded
          </h1>
        </Link>

        <div className="ml-auto text-xs font-body text-gray-400">
          Powered by The Guardian &amp; Gemini
        </div>
      </div>
    </header>
  );
}
