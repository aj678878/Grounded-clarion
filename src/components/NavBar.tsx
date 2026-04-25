'use client';

import { useState, useEffect } from 'react';
import { CATEGORIES, type Category } from '@/types';
import DarkModeToggle from './DarkModeToggle';

interface NavBarProps {
  active: Category;
  onChange: (tab: Category) => void;
  searchQuery: string;
  onSearch: (query: string) => void;
}

export default function NavBar({ active, onChange, searchQuery, onSearch }: NavBarProps) {
  const [input, setInput] = useState(searchQuery);

  useEffect(() => {
    setInput(searchQuery);
  }, [searchQuery]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    onSearch(input.trim());
  };

  return (
    <nav
      className="sticky top-0 z-[80] w-full"
      style={{
        background: 'var(--paper)',
        borderBottom: '2px solid var(--ink)',
      }}
    >
      <div className="mx-auto flex max-w-[1280px] flex-wrap items-center gap-x-2 gap-y-2 px-4 py-2 sm:px-6">
        {/* Category tabs */}
        <div className="flex flex-1 items-center gap-1 overflow-x-auto" role="tablist">
          {CATEGORIES.map((cat) => {
            const isActive = cat === active && !searchQuery;
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
        </div>

        {/* Search + dark-mode toggle */}
        <form onSubmit={submit} className="flex items-center gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Search topics…"
            className="font-body italic"
            style={{
              fontSize: '12px',
              width: '170px',
              padding: '7px 10px',
              border: '1px solid var(--border)',
              background: 'var(--paper)',
              color: 'var(--ink)',
              outline: 'none',
              borderRadius: 0,
            }}
            onFocus={(e) => (e.currentTarget.style.borderColor = 'var(--accent)')}
            onBlur={(e) => (e.currentTarget.style.borderColor = 'var(--border)')}
          />
          <button
            type="submit"
            className="font-ui uppercase"
            style={{
              fontSize: '11px',
              fontWeight: 600,
              letterSpacing: '0.7px',
              padding: '7px 14px',
              background: 'var(--ink)',
              color: 'var(--paper)',
              border: '1px solid var(--ink)',
            }}
          >
            Search
          </button>
          <DarkModeToggle />
        </form>
      </div>
    </nav>
  );
}
