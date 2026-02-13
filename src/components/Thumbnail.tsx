'use client';

interface ThumbnailProps {
  src?: string;
  alt: string;
  sectionName?: string;
}

/** Article thumbnail with a coloured placeholder fallback. */
export default function Thumbnail({ src, alt, sectionName }: ThumbnailProps) {
  if (!src) {
    // Coloured placeholder with section initial
    const initial = (sectionName ?? 'G').charAt(0).toUpperCase();
    return (
      <div
        className="flex h-full w-full items-center justify-center bg-gradient-to-br from-primary/10 to-primary/5 text-primary/40"
        aria-hidden="true"
      >
        <span className="font-headline text-2xl font-bold">{initial}</span>
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      className="h-full w-full object-cover"
      loading="lazy"
    />
  );
}
