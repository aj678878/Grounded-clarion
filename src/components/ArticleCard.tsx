'use client';

import Link from 'next/link';
import { GuardianArticle } from '@/types';
import ImgPlaceholder from './ImgPlaceholder';

interface CardProps {
  article: GuardianArticle;
  index?: number;
}

function stripHtml(text: string): string {
  return text.replace(/<[^>]+>/g, '').trim();
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max).replace(/\s+\S*$/, '') + '…';
}

function bylineFromUrl(url: string): string {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    return `Clarion · ${host}`;
  } catch {
    return 'Clarion';
  }
}

/* ---------- Column card (used inside the 3-col front-page grid) ---------- */

export function ColCard({ article, index = 1 }: CardProps) {
  const trail = stripHtml(article.trailText ?? '');
  const href = `/article/${article.id}`;

  return (
    <article
      className="py-5"
      style={{ borderBottom: '1px solid var(--border)' }}
    >
      <p
        className="font-ui uppercase"
        style={{
          fontSize: '10px',
          fontWeight: 600,
          letterSpacing: '1px',
          color: 'var(--ink-3)',
          marginBottom: '6px',
        }}
      >
        {article.category} · {String(index).padStart(2, '0')}
      </p>

      <Link href={href} className="block group">
        <h3
          className="font-headline transition-colors"
          style={{
            fontSize: '18.5px',
            fontWeight: 700,
            lineHeight: 1.22,
            color: 'var(--ink)',
          }}
        >
          <span className="group-hover:[color:var(--accent)]">{article.webTitle}</span>
        </h3>
      </Link>

      <p
        className="font-ui uppercase"
        style={{
          fontSize: '10.5px',
          fontWeight: 600,
          letterSpacing: '0.7px',
          color: 'var(--ink-3)',
          marginTop: '8px',
        }}
      >
        {bylineFromUrl(article.webUrl)}
      </p>

      {trail && (
        <p
          className="font-body"
          style={{
            fontSize: '13.5px',
            lineHeight: 1.6,
            color: 'var(--ink-2)',
            marginTop: '10px',
          }}
        >
          {truncate(trail, 160)}
        </p>
      )}

      <Link
        href={href}
        className="font-ui uppercase mt-3 inline-block"
        style={{
          fontSize: '10.5px',
          fontWeight: 600,
          letterSpacing: '0.7px',
          color: 'var(--accent)',
          textDecoration: 'underline',
        }}
      >
        Read &amp; discuss →
      </Link>
    </article>
  );
}

/* ---------- Flat card (used in the filtered / search single-column view) ---------- */

export function FlatCard({ article, index = 1 }: CardProps) {
  const trail = stripHtml(article.trailText ?? '');
  const href = `/article/${article.id}`;

  return (
    <article
      className="grid gap-6 py-6"
      style={{
        gridTemplateColumns: '1fr 180px',
        borderBottom: '1px solid var(--border)',
      }}
    >
      <div>
        <p
          className="font-ui uppercase"
          style={{
            fontSize: '10px',
            fontWeight: 600,
            letterSpacing: '1px',
            color: 'var(--red)',
            marginBottom: '8px',
          }}
        >
          {article.category} · {String(index).padStart(2, '0')}
        </p>

        <Link href={href} className="block group">
          <h3
            className="font-headline transition-colors"
            style={{
              fontSize: '22px',
              fontWeight: 700,
              lineHeight: 1.18,
              color: 'var(--ink)',
            }}
          >
            <span className="group-hover:[color:var(--accent)]">{article.webTitle}</span>
          </h3>
        </Link>

        <p
          className="font-ui uppercase"
          style={{
            fontSize: '10.5px',
            fontWeight: 600,
            letterSpacing: '0.7px',
            color: 'var(--ink-3)',
            marginTop: '8px',
          }}
        >
          {bylineFromUrl(article.webUrl)}
        </p>

        {trail && (
          <p
            className="font-body"
            style={{
              fontSize: '14px',
              lineHeight: 1.65,
              color: 'var(--ink-2)',
              marginTop: '10px',
            }}
          >
            {trail}
          </p>
        )}

        <Link
          href={href}
          className="font-ui uppercase mt-3 inline-block"
          style={{
            fontSize: '10.5px',
            fontWeight: 600,
            letterSpacing: '0.7px',
            color: 'var(--accent)',
            textDecoration: 'underline',
          }}
        >
          Read &amp; discuss →
        </Link>
      </div>

      <div className="hidden sm:block">
        <ImgPlaceholder ratio="square" caption={article.category.toUpperCase()} />
      </div>
    </article>
  );
}

/** Default export keeps backwards compatibility with any straggling `import ArticleCard` sites. */
export default ColCard;
