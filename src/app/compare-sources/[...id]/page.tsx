import Link from 'next/link';
import { fetchArticle } from '@/lib/guardian';
import { runCompareSources } from '@/lib/synthesis/run';

interface PageProps {
  params: { id: string[] };
}

export default async function CompareSourcesPage({ params }: PageProps) {
  const articleId = params.id.join('/');
  const article = await fetchArticle(articleId);
  const result = await runCompareSources({
    article_id: article.id,
    article_title: article.webTitle,
    article_content: article.bodyHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
    article_source_url: article.webUrl,
    article_source_domain: new URL(article.webUrl).hostname.replace(/^www\./, ''),
  });

  return (
    <main className="mx-auto max-w-4xl px-6 py-10 font-body">
      <div className="mb-6 flex items-center justify-between">
        <Link href={`/article/${articleId}`} className="text-sm text-primary hover:underline">
          ← Back to article
        </Link>
        <span className="text-xs uppercase tracking-widest text-gray-400">Compare Sources</span>
      </div>
      <h1 className="font-headline text-3xl text-[var(--ink)]">{article.webTitle}</h1>
      <pre className="mt-6 overflow-auto rounded-lg border border-gray-200 bg-white p-4 text-xs text-gray-700">
        {JSON.stringify(result, null, 2)}
      </pre>
    </main>
  );
}
