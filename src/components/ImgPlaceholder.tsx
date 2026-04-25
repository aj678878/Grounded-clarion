'use client';

interface ImgPlaceholderProps {
  caption?: string;
  ratio?: 'tall' | 'wide' | 'square';
  className?: string;
}

const RATIO_TO_PADDING: Record<NonNullable<ImgPlaceholderProps['ratio']>, string> = {
  tall: '125%',
  wide: '56.25%',
  square: '100%',
};

export default function ImgPlaceholder({
  caption,
  ratio = 'tall',
  className = '',
}: ImgPlaceholderProps) {
  return (
    <div className={`img-placeholder ${className}`} style={{ width: '100%' }}>
      <div style={{ paddingTop: RATIO_TO_PADDING[ratio] }} />
      {caption && (
        <div
          className="absolute bottom-0 left-0 right-0 px-3 py-1.5 font-ui uppercase"
          style={{
            fontSize: '10px',
            letterSpacing: '0.8px',
            color: 'var(--ink-3)',
            background: 'var(--paper-card)',
            borderTop: '1px solid var(--border)',
          }}
        >
          {caption}
        </div>
      )}
    </div>
  );
}
