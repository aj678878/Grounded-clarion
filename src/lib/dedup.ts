/* ------------------------------------------------------------------ */
/*  Lightweight title-based deduplication                             */
/* ------------------------------------------------------------------ */

import { GuardianArticle } from '@/types';

/** Normalize a title for dedup comparison. */
export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Remove articles with duplicate normalized titles, keeping first occurrence. */
export function deduplicateArticles(articles: GuardianArticle[]): GuardianArticle[] {
  const seen = new Set<string>();
  return articles.filter((article) => {
    const key = normalizeTitle(article.webTitle);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
