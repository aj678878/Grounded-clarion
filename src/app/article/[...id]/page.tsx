/* ------------------------------------------------------------------ */
/*  Article page — SERVER COMPONENT                                   */
/*  Fetches article exactly once on the server, passes to client.     */
/* ------------------------------------------------------------------ */

import { fetchArticle } from '@/lib/guardian';
import ArticleView from './ArticleView';
import ArticleNav from '@/components/ArticleNav';
import ErrorState from '@/components/ErrorState';

interface PageProps {
  params: { id: string[] };
}

export default async function ArticlePage({ params }: PageProps) {
  const articleId = params.id.join('/');

  try {
    const article = await fetchArticle(articleId);
    return <ArticleView article={article} />;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to load article';
    return (
      <div className="min-h-screen" style={{ background: 'var(--paper)' }}>
        <ArticleNav backHref="/" />
        <div className="mx-auto max-w-3xl px-6 py-16">
          <ErrorState message={message} />
          <div className="mt-4 text-center">
            <a
              href={`/article/${articleId}`}
              className="font-ui uppercase"
              style={{
                fontSize: '11px',
                fontWeight: 600,
                letterSpacing: '0.7px',
                color: 'var(--accent)',
                textDecoration: 'underline',
              }}
            >
              Reload page to retry
            </a>
          </div>
        </div>
      </div>
    );
  }
}
