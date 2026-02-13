'use client';

import Link from 'next/link';
import { GuardianArticle, SECTION_COLORS } from '@/types';
import Thumbnail from './Thumbnail';
import Button from './Button';

interface ArticleCardProps {
  article: GuardianArticle;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return iso;
  }
}

export default function ArticleCard({ article }: ArticleCardProps) {
  const chipColor =
    SECTION_COLORS[article.category.toLowerCase()] ??
    SECTION_COLORS[article.sectionId] ??
    'bg-gray-100 text-gray-600 border-gray-200';

  return (
    <article className="group flex gap-4 rounded-lg border border-gray-100 bg-white p-4 transition-shadow hover:shadow-md">
      {/* Thumbnail */}
      <div className="hidden sm:block h-28 w-28 flex-shrink-0 overflow-hidden rounded-md bg-gray-50">
        <Thumbnail src={article.thumbnail} alt={article.webTitle} sectionName={article.category} />
      </div>

      {/* Content */}
      <div className="flex min-w-0 flex-1 flex-col justify-between">
        <div>
          {/* Section chip + date */}
          <div className="mb-1.5 flex flex-wrap items-center gap-2">
            <span
              className={`inline-block rounded-full border px-2.5 py-0.5 text-xs font-medium ${chipColor}`}
            >
              {article.category}
            </span>
            <time className="text-xs text-gray-400 font-body" dateTime={article.webPublicationDate}>
              {formatDate(article.webPublicationDate)}
            </time>
          </div>

          {/* Headline */}
          <h3 className="font-headline text-base font-bold leading-snug text-gray-900 line-clamp-2 group-hover:text-primary transition-colors">
            {article.webTitle}
          </h3>

          {/* Trail text */}
          {article.trailText && (
            <p
              className="mt-1 text-sm text-gray-500 font-body line-clamp-2"
              dangerouslySetInnerHTML={{ __html: article.trailText }}
            />
          )}
        </div>

        {/* Open button */}
        <div className="mt-3 flex items-end justify-end">
          <Link href={`/article/${article.id}`} tabIndex={-1}>
            <Button variant="secondary" size="sm">
              Read &amp; discuss
            </Button>
          </Link>
        </div>
      </div>
    </article>
  );
}
