/* ------------------------------------------------------------------ */
/*  Guardian Content API integration                                  */
/* ------------------------------------------------------------------ */

import { getGuardianApiKey, getGuardianBaseUrl } from './env';
import { GuardianArticle, ArticleDetail } from '@/types';

const SECTIONS = ['business', 'world', 'technology'] as const;
const INDIA_QUERY = 'India';
const PER_SECTION = 8; // ~8 per source → ~32 raw → ~30 after dedup

/* ---------- fetch with retry (2 retries) ---------- */

async function fetchWithRetry(
  url: string,
  retries = 2,
  /** Pass true for feed requests that must always be fresh. */
  noCache = false
): Promise<Response> {
  let lastError: Error | null = null;
  const fetchOptions: RequestInit = noCache
    ? { cache: 'no-store' }
    : {}; // article fetches can use default caching

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, fetchOptions);
      if (res.ok) return res;
      if (res.status === 429) {
        throw new Error('QUOTA_EXCEEDED');
      }
      lastError = new Error(`Guardian API returned ${res.status}`);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (lastError.message === 'QUOTA_EXCEEDED') throw lastError;
    }
  }
  throw lastError ?? new Error('Guardian API request failed after retries');
}

/* ---------- map raw Guardian result → GuardianArticle ---------- */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapResult(result: any, category: string): GuardianArticle {
  return {
    id: result.id,
    webTitle: result.webTitle,
    webPublicationDate: result.webPublicationDate,
    sectionName: result.sectionName,
    sectionId: result.sectionId ?? result.sectionName?.toLowerCase() ?? '',
    webUrl: result.webUrl,
    trailText: result.fields?.trailText ?? '',
    thumbnail: result.fields?.thumbnail ?? '',
    category,
  };
}

/* ---------- balanced feed ---------- */

export async function fetchBalancedFeed(page: number = 1): Promise<GuardianArticle[]> {
  const apiKey = getGuardianApiKey();
  const base = getGuardianBaseUrl();

  const sectionFetches = SECTIONS.map((section) =>
    fetchWithRetry(
      `${base}/${section}?page=${page}&page-size=${PER_SECTION}&order-by=newest&show-fields=trailText,thumbnail&api-key=${apiKey}`,
      2,
      true // always fresh for feed
    ).then((r) => r.json())
  );

  const indiaFetch = fetchWithRetry(
    `${base}/search?q=${INDIA_QUERY}&page=${page}&page-size=${PER_SECTION}&order-by=newest&show-fields=trailText,thumbnail&api-key=${apiKey}`,
    2,
    true // always fresh for feed
  ).then((r) => r.json());

  const results = await Promise.all([...sectionFetches, indiaFetch]);
  const categoryNames = [...SECTIONS.map((s) => s.charAt(0).toUpperCase() + s.slice(1)), 'India'];

  return results.flatMap((r, i) =>
    (r.response?.results ?? []).map((item: unknown) => mapResult(item, categoryNames[i]))
  );
}

/* ---------- search feed ---------- */

export async function searchFeed(query: string, page: number = 1): Promise<GuardianArticle[]> {
  const apiKey = getGuardianApiKey();
  const base = getGuardianBaseUrl();

  const res = await fetchWithRetry(
    `${base}/search?q=${encodeURIComponent(query)}&page=${page}&page-size=30&order-by=newest&show-fields=trailText,thumbnail&api-key=${apiKey}`,
    2,
    true // always fresh for feed
  );
  const data = await res.json();
  return (data.response?.results ?? []).map((item: unknown) => mapResult(item, 'Search'));
}

/* ---------- single article with server-side cache ---------- */

const articleCache = new Map<string, ArticleDetail>();

export async function fetchArticle(id: string): Promise<ArticleDetail> {
  const cached = articleCache.get(id);
  if (cached) return cached;

  const apiKey = getGuardianApiKey();
  const base = getGuardianBaseUrl();

  const res = await fetchWithRetry(
    `${base}/${id}?show-fields=body,trailText,thumbnail,wordcount,byline&api-key=${apiKey}`
  );
  const data = await res.json();
  const content = data.response?.content;

  if (!content) throw new Error('Article not found');

  const wordcountRaw = content.fields?.wordcount;
  const wordcount =
    typeof wordcountRaw === 'string' ? parseInt(wordcountRaw, 10) || undefined : undefined;

  const article: ArticleDetail = {
    id: content.id,
    webTitle: content.webTitle,
    webPublicationDate: content.webPublicationDate,
    sectionName: content.sectionName,
    sectionId: content.sectionId ?? '',
    webUrl: content.webUrl,
    trailText: content.fields?.trailText ?? '',
    thumbnail: content.fields?.thumbnail ?? '',
    bodyHtml: content.fields?.body ?? '',
    wordcount,
    byline: content.fields?.byline ?? '',
    category: content.sectionName,
  };

  articleCache.set(id, article);
  return article;
}
