'use client';

import { ArticleDetail } from '@/types';
import ArticleNav from '@/components/ArticleNav';
import ChatPanel from '@/components/ChatPanel';

interface ArticleViewProps {
  article: ArticleDetail;
}

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

function readingTime(article: ArticleDetail, plainText: string): string {
  const words = article.wordcount ?? Math.max(1, plainText.split(/\s+/).length);
  const mins = Math.max(1, Math.round(words / 220));
  return `${mins} min read`;
}

function bylineText(article: ArticleDetail): string {
  if (article.byline) return article.byline;
  return 'Clarion Editorial Desk';
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

export default function ArticleView({ article }: ArticleViewProps) {
  const plainText = htmlToText(article.bodyHtml);

  return (
    <div className="flex h-screen flex-col" style={{ background: 'var(--paper)' }}>
      <ArticleNav backHref="/" />

      <div
        className="grid flex-1 min-h-0"
        style={{ gridTemplateColumns: 'minmax(0, 1fr) 340px' }}
      >
        {/* ---- Article (left, scrollable) ---- */}
        <main
          className="overflow-y-auto"
          style={{
            borderRight: '1px solid var(--border)',
            background: 'var(--paper)',
            overscrollBehavior: 'contain',
          }}
        >
          <article
            className="mx-auto"
            style={{ maxWidth: '680px', padding: '52px 40px 100px' }}
          >
            {/* Section + article number */}
            <p
              className="font-ui uppercase"
              style={{
                fontSize: '10.5px',
                fontWeight: 600,
                letterSpacing: '1.8px',
                color: 'var(--red)',
              }}
            >
              {article.sectionName} · Article No. 1
            </p>

            {/* Headline */}
            <h1
              className="font-headline mt-3"
              style={{
                fontSize: 'clamp(28px, 4.5vw, 46px)',
                fontWeight: 700,
                lineHeight: 1.12,
                color: 'var(--ink)',
              }}
            >
              {article.webTitle}
            </h1>

            {/* Trail / dek */}
            {article.trailText && (
              <p
                className="font-body italic mt-5"
                style={{
                  fontSize: '17.5px',
                  lineHeight: 1.65,
                  color: 'var(--ink-2)',
                }}
                dangerouslySetInnerHTML={{ __html: article.trailText }}
              />
            )}

            {/* Byline block */}
            <div
              className="flex items-center justify-between mt-7"
              style={{
                borderTop: '2px solid var(--ink)',
                borderBottom: '1px solid var(--border)',
                padding: '12px 0',
                marginBottom: '36px',
              }}
            >
              <div className="flex flex-col">
                <span
                  className="font-ui uppercase"
                  style={{
                    fontSize: '11.5px',
                    fontWeight: 600,
                    letterSpacing: '0.7px',
                    color: 'var(--ink)',
                  }}
                >
                  {bylineText(article)}
                </span>
                <span
                  className="font-ui"
                  style={{ fontSize: '11.5px', color: 'var(--ink-3)' }}
                >
                  {formatDate(article.webPublicationDate)}
                </span>
              </div>
              <span
                className="font-ui italic"
                style={{ fontSize: '11px', color: 'var(--ink-3)' }}
              >
                {readingTime(article, plainText)}
              </span>
            </div>

            {/* Body */}
            <div
              className="article-prose"
              dangerouslySetInnerHTML={{ __html: article.bodyHtml }}
            />

            {/* Footer */}
            <div className="mt-10" style={{ borderTop: '1px solid var(--border)', paddingTop: '14px' }}>
              <a
                href={article.webUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="font-ui uppercase"
                style={{
                  fontSize: '11px',
                  fontWeight: 600,
                  letterSpacing: '0.7px',
                  color: 'var(--ink-3)',
                }}
              >
                Read original source →
              </a>
            </div>
          </article>
        </main>

        {/* ---- Chat sidebar (right, sticky) ---- */}
        <aside
          className="hidden md:flex flex-col min-h-0 overflow-hidden"
          style={{ background: 'var(--paper-card)' }}
        >
          <ChatPanel
            articleId={article.id}
            articleTitle={article.webTitle}
            articleText={plainText}
            articleSourceUrl={article.webUrl}
            articleSourceDomain={new URL(article.webUrl).hostname.replace(/^www\./, '')}
            articlePublishedAt={article.webPublicationDate}
          />
        </aside>
      </div>
    </div>
  );
}
