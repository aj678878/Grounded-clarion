'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { ArticleDetail } from '@/types';
import { getCachedArticle, setCachedArticle } from '@/lib/session';
import Header from '@/components/Header';
import ChatPanel from '@/components/ChatPanel';
import LoadingState from '@/components/LoadingState';
import ErrorState from '@/components/ErrorState';

export default function ArticlePage() {
  const params = useParams();
  const idSegments = params.id as string[];
  const articleId = idSegments.join('/');

  const [article, setArticle] = useState<ArticleDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchArticle = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    // Check client-side cache first
    const cached = getCachedArticle(articleId);
    if (cached) {
      try {
        setArticle(JSON.parse(cached));
        setIsLoading(false);
        return;
      } catch {
        // corrupted cache — refetch
      }
    }

    try {
      const res = await fetch(`/api/article?id=${encodeURIComponent(articleId)}`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Failed to load article (${res.status})`);
      }
      const data = await res.json();
      setArticle(data.article);

      // Cache in sessionStorage
      setCachedArticle(articleId, JSON.stringify(data.article));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load article');
    } finally {
      setIsLoading(false);
    }
  }, [articleId]);

  useEffect(() => {
    fetchArticle();
  }, [fetchArticle]);

  /* ---- Strip HTML to plain text for LLM context ---- */
  function htmlToText(html: string): string {
    return html
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\s+/g, ' ')
      .trim();
  }

  if (isLoading) {
    return (
      <div className="min-h-screen">
        <Header backHref="/" backLabel="Back to Feed" />
        <div className="mx-auto max-w-7xl px-4 py-12">
          <LoadingState message="Loading article…" />
        </div>
      </div>
    );
  }

  if (error || !article) {
    return (
      <div className="min-h-screen">
        <Header backHref="/" backLabel="Back to Feed" />
        <div className="mx-auto max-w-7xl px-4 py-12">
          <ErrorState
            message={error || 'Article not found'}
            onRetry={fetchArticle}
          />
        </div>
      </div>
    );
  }

  const plainText = htmlToText(article.bodyHtml);

  return (
    <div className="flex min-h-screen flex-col">
      <Header backHref="/" backLabel="Back to Feed" />

      <div className="flex flex-1 overflow-hidden">
        {/* Article content — 80% */}
        <main className="flex-1 overflow-y-auto" style={{ flex: '4 1 0%' }}>
          <article className="mx-auto max-w-article px-6 py-8 sm:px-10 lg:px-16">
            {/* Section + date */}
            <div className="mb-4 flex flex-wrap items-center gap-3">
              <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary font-body">
                {article.sectionName}
              </span>
              <time className="text-xs text-gray-400 font-body" dateTime={article.webPublicationDate}>
                {new Date(article.webPublicationDate).toLocaleDateString('en-GB', {
                  weekday: 'long',
                  day: 'numeric',
                  month: 'long',
                  year: 'numeric',
                })}
              </time>
            </div>

            {/* Headline */}
            <h1 className="font-headline text-3xl font-bold leading-tight text-gray-900 sm:text-4xl">
              {article.webTitle}
            </h1>

            {/* Trail text */}
            {article.trailText && (
              <p
                className="mt-4 text-lg leading-relaxed text-gray-600 font-body"
                dangerouslySetInnerHTML={{ __html: article.trailText }}
              />
            )}

            <hr className="my-6 border-gray-200" />

            {/* Body */}
            <div
              className="prose prose-gray max-w-none font-body
                prose-headings:font-headline
                prose-p:text-[17px] prose-p:leading-[1.8]
                prose-a:text-primary prose-a:underline
                prose-img:rounded-md
                prose-blockquote:border-primary/30"
              dangerouslySetInnerHTML={{ __html: article.bodyHtml }}
            />

            {/* Source link */}
            <div className="mt-8 border-t border-gray-200 pt-4">
              <a
                href={article.webUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-gray-400 hover:text-primary font-body transition-colors"
              >
                Read original on The Guardian →
              </a>
            </div>
          </article>
        </main>

        {/* Chat sidebar — 20% */}
        <div
          className="hidden md:flex flex-col border-l border-gray-200 bg-white"
          style={{ flex: '1 1 0%', minWidth: '320px', maxWidth: '400px' }}
        >
          <ChatPanel articleId={articleId} articleText={plainText} />
        </div>
      </div>

      {/* Mobile chat toggle — shown at bottom on small screens */}
      <MobileChatToggle articleId={articleId} articleText={plainText} />
    </div>
  );
}

/* ---- Mobile chat drawer ---- */
function MobileChatToggle({ articleId, articleText }: { articleId: string; articleText: string }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* FAB */}
      <button
        onClick={() => setOpen(!open)}
        className="fixed bottom-4 right-4 z-40 flex h-12 w-12 items-center justify-center rounded-full bg-primary text-white shadow-lg md:hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2"
        aria-label={open ? 'Close chat' : 'Open chat'}
      >
        {open ? (
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
          </svg>
        ) : (
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M18 10c0 3.866-3.582 7-8 7a8.841 8.841 0 01-4.083-.98L2 17l1.338-3.123C2.493 12.767 2 11.434 2 10c0-3.866 3.582-7 8-7s8 3.134 8 7zM7 9H5v2h2V9zm8 0h-2v2h2V9zM9 9h2v2H9V9z" clipRule="evenodd" />
          </svg>
        )}
      </button>

      {/* Drawer */}
      {open && (
        <div className="fixed inset-x-0 bottom-0 z-30 h-[70vh] md:hidden border-t border-gray-200 shadow-2xl rounded-t-xl overflow-hidden">
          <ChatPanel articleId={articleId} articleText={articleText} />
        </div>
      )}
    </>
  );
}
