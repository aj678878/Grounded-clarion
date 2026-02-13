/* ------------------------------------------------------------------ */
/*  Article page — SERVER COMPONENT                                   */
/*  Fetches article exactly once on the server, passes to client.     */
/* ------------------------------------------------------------------ */

import { fetchArticle } from '@/lib/guardian';
import ArticleView from './ArticleView';
import Header from '@/components/Header';
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
      <div className="min-h-screen">
        <Header backHref="/" backLabel="Back to Feed" />
        <div className="mx-auto max-w-3xl px-4 py-16">
          <ErrorState message={message} />
          {/* Reload-based retry since this is a server component */}
          <div className="mt-4 text-center">
            <a
              href={`/article/${articleId}`}
              className="text-sm font-body text-primary hover:underline"
            >
              Reload page to retry
            </a>
          </div>
        </div>
      </div>
    );
  }
}
