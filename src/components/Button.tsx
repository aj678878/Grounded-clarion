'use client';

import { ButtonHTMLAttributes, forwardRef } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'clear';

const variantStyles: Record<Variant, string> = {
  primary:
    'bg-primary text-white hover:bg-primary-light focus-visible:ring-primary/40 shadow-sm',
  secondary:
    'bg-white text-primary border border-primary/20 hover:border-primary/40 focus-visible:ring-primary/20',
  ghost:
    'text-gray-600 hover:text-gray-900 hover:bg-gray-100 focus-visible:ring-gray-300',
  clear:
    'text-emerald-700 hover:text-emerald-800 hover:bg-emerald-50 border border-emerald-200 focus-visible:ring-emerald-300',
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: 'sm' | 'md';
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'primary', size = 'md', className = '', children, ...props }, ref) => {
    const base =
      'inline-flex items-center justify-center rounded-md font-body font-medium transition-colors ' +
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 ' +
      'disabled:pointer-events-none disabled:opacity-50';
    const sizeStyles = size === 'sm' ? 'px-3 py-1.5 text-sm' : 'px-4 py-2 text-sm';

    return (
      <button
        ref={ref}
        className={`${base} ${variantStyles[variant]} ${sizeStyles} ${className}`}
        {...props}
      >
        {children}
      </button>
    );
  }
);

Button.displayName = 'Button';
export default Button;
