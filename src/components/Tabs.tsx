'use client';

import { CATEGORIES, type Category } from '@/types';

interface TabsProps {
  active: Category;
  onChange: (tab: Category) => void;
}

/**
 * Standalone tab strip — same uppercase navy-underline style as NavBar's
 * inline tabs. Kept as a separate component for any context that wants the
 * tabs without the masthead nav (e.g. modals or future surfaces).
 */
export default function Tabs({ active, onChange }: TabsProps) {
  return (
    <nav
      className="flex gap-1 overflow-x-auto"
      role="tablist"
      style={{ borderBottom: '2px solid var(--ink)' }}
    >
      {CATEGORIES.map((cat) => {
        const isActive = cat === active;
        return (
          <button
            key={cat}
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(cat)}
            className="font-ui uppercase whitespace-nowrap transition-colors"
            style={{
              fontSize: '12px',
              fontWeight: 600,
              letterSpacing: '0.7px',
              padding: '12px 14px',
              marginBottom: isActive ? '-2px' : 0,
              background: 'transparent',
              color: isActive ? 'var(--accent)' : 'var(--ink-2)',
              borderBottom: isActive
                ? '3px solid var(--accent)'
                : '3px solid transparent',
            }}
          >
            {cat}
          </button>
        );
      })}
    </nav>
  );
}
