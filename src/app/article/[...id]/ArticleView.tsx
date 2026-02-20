'use client';

import { useState } from 'react';
import { ArticleDetail } from '@/types';
import Header from '@/components/Header';
import ChatPanel from '@/components/ChatPanel';

interface ArticleViewProps {
  article: ArticleDetail;
}

/** Strip HTML to plain text for the LLM context window. */
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

export default function ArticleView({ article }: ArticleViewProps) {
  const plainText = htmlToText(article.bodyHtml);

  return (
    <div className="flex h-screen flex-col">
      <Header backHref="/" backLabel="Back to Feed" />

      {/*
        Two-column body that fills the remaining viewport height.
        min-h-0 is essential so flex children can shrink and enable overflow scroll.
      */}
      <div className="flex flex-1 min-h-0">
        {/* ---- Left: scrollable article column (80%) ---- */}
        <main className="flex-[4] overflow-y-auto">
          <article className="mx-auto max-w-article px-6 py-8 sm:px-10 lg:px-16">
            {/* Section + date */}
            <div className="mb-4 flex flex-wrap items-center gap-3">
              <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary font-body">
                {article.sectionName}
              </span>
              <time
                className="text-xs text-gray-400 font-body"
                dateTime={article.webPublicationDate}
              >
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
            <div className="mt-8 border-t border-gray-200 pt-4 pb-12">
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

        {/* ---- Right: sticky chat sidebar (20%) ---- */}
        <aside
          className="hidden md:flex flex-col border-l border-gray-200 bg-white"
          style={{ width: '340px', minWidth: '300px', maxWidth: '400px' }}
        >
          <ChatPanel articleId={article.id} articleTitle={article.webTitle} articleText={plainText} />
        </aside>
      </div>

      {/* Mobile chat FAB + drawer */}
      <MobileChatToggle articleId={article.id} articleTitle={article.webTitle} articleText={plainText} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Mobile chat drawer (small screens)                                */
/* ------------------------------------------------------------------ */

function MobileChatToggle({
  articleId,
  articleTitle,
  articleText,
}: {
  articleId: string;
  articleTitle: string;
  articleText: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* Floating action button */}
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
        <div className="fixed inset-x-0 bottom-0 z-30 h-[70vh] md:hidden border-t border-gray-200 shadow-2xl rounded-t-xl overflow-hidden bg-white">
          <ChatPanel articleId={articleId} articleTitle={articleTitle} articleText={articleText} />
        </div>
      )}
    </>
  );
}
