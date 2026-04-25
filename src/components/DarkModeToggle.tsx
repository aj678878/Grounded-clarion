'use client';

import { useDarkMode } from '@/lib/useDarkMode';

export default function DarkModeToggle({ compact = false }: { compact?: boolean }) {
  const { isDark, toggle } = useDarkMode();
  return (
    <button
      type="button"
      onClick={toggle}
      className="font-ui uppercase whitespace-nowrap transition-colors"
      style={{
        fontSize: '11px',
        fontWeight: 600,
        letterSpacing: '0.7px',
        padding: compact ? '5px 10px' : '7px 14px',
        border: '1px solid var(--ink)',
        background: 'transparent',
        color: 'var(--ink)',
      }}
      aria-label={isDark ? 'Switch to day mode' : 'Switch to night mode'}
    >
      {isDark ? 'Day' : 'Night'}
    </button>
  );
}
