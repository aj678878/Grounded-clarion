'use client';

import { CATEGORIES, type Category } from '@/types';

interface TabsProps {
  active: Category;
  onChange: (tab: Category) => void;
}

export default function Tabs({ active, onChange }: TabsProps) {
  return (
    <nav className="flex gap-1 overflow-x-auto border-b border-gray-200 pb-px" role="tablist">
      {CATEGORIES.map((cat) => {
        const isActive = cat === active;
        return (
          <button
            key={cat}
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(cat)}
            className={
              'whitespace-nowrap rounded-t-md px-4 py-2 text-sm font-body font-medium transition-colors ' +
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 ' +
              (isActive
                ? 'border-b-2 border-primary text-primary'
                : 'text-gray-500 hover:text-gray-800 hover:bg-gray-50')
            }
          >
            {cat}
          </button>
        );
      })}
    </nav>
  );
}
