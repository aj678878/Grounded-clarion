'use client';

interface SectionRuleProps {
  label: string;
  variant?: 'ink' | 'red';
  className?: string;
}

export default function SectionRule({ label, variant = 'ink', className = '' }: SectionRuleProps) {
  const isRed = variant === 'red';
  const lineColor = isRed ? 'var(--red)' : 'var(--ink)';
  const labelColor = isRed ? 'var(--red)' : 'var(--ink)';
  const lineHeight = isRed ? '1px' : '2px';

  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <span style={{ flex: 1, height: lineHeight, background: lineColor }} />
      <span
        className="font-ui uppercase"
        style={{
          fontSize: '10.5px',
          fontWeight: 600,
          letterSpacing: '1.8px',
          color: labelColor,
        }}
      >
        {label}
      </span>
      <span style={{ flex: 1, height: lineHeight, background: lineColor }} />
    </div>
  );
}
