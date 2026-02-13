'use client';

import { InputHTMLAttributes, forwardRef } from 'react';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  /** Visually hidden label for accessibility */
  label?: string;
}

const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, className = '', ...props }, ref) => {
    return (
      <div className="w-full">
        {label && <span className="sr-only">{label}</span>}
        <input
          ref={ref}
          className={
            'w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm font-body ' +
            'text-gray-900 placeholder:text-gray-400 ' +
            'focus:border-primary/40 focus:outline-none focus:ring-2 focus:ring-primary/20 ' +
            'disabled:opacity-50 ' +
            className
          }
          {...props}
        />
      </div>
    );
  }
);

Input.displayName = 'Input';
export default Input;
