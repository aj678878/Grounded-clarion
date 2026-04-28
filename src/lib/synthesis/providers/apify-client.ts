import { normalizeDomain } from '../source-tiers';

const APIFY_BASE_URL = 'https://api.apify.com/v2/acts';
const FAST_NEWS_ACTOR = 'timgreen~fast-news-scraper';
const BLOOMBERG_ACTOR = 'romy~bloomberg-news-scraper';

export interface ApifyExtractionResult {
  ok: boolean;
  error: string | null;
  raw_response: unknown;
  content: string;
  headline: string;
  url: string;
  item_count: number;
}

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .map((token) => token.trim())
      .filter((token) => token.length >= 3)
  );
}

function overlapScore(a: Set<string>, b: Set<string>): number {
  let score = 0;
  a.forEach((token) => {
    if (b.has(token)) score += 1;
  });
  return score;
}

function pickBestItem(
  items: Array<Record<string, unknown>>,
  input: { url: string; headline: string }
): Record<string, unknown> | null {
  if (items.length === 0) return null;

  const targetUrl = input.url.trim();
  const targetTokens = tokenize(input.headline);

  const scored = items.map((item) => {
    const itemUrl =
      typeof item.url === 'string'
        ? item.url
        : typeof item.link === 'string'
        ? item.link
        : '';
    const itemHeadline =
      typeof item.title === 'string'
        ? item.title
        : typeof item.headline === 'string'
        ? item.headline
        : '';

    let score = 0;
    if (itemUrl && itemUrl === targetUrl) score += 10;
    score += overlapScore(targetTokens, tokenize(itemHeadline)) * 2;
    return { item, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.item ?? null;
}

function extractItemText(item: Record<string, unknown>): string {
  const candidates = [
    item.content,
    item.articleBody,
    item.body,
    item.text,
    item.raw_content,
    item.markdown,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim();
    }
  }
  return '';
}

async function runActor(
  actorId: string,
  body: Record<string, unknown>,
  timeoutMs = 12_000
): Promise<{ ok: boolean; error: string | null; raw_response: unknown; items: Array<Record<string, unknown>> }> {
  const token = process.env.APIFY_TOKEN;
  if (!token) {
    return { ok: false, error: 'APIFY_TOKEN not set', raw_response: null, items: [] };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const url = `${APIFY_BASE_URL}/${actorId}/run-sync-get-dataset-items?token=${encodeURIComponent(token)}`;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const rawText = await res.text();
    if (!res.ok) {
      return {
        ok: false,
        error: `Apify ${res.status}: ${rawText.slice(0, 300)}`,
        raw_response: rawText,
        items: [],
      };
    }

    const parsed = JSON.parse(rawText) as unknown;
    const items = Array.isArray(parsed)
      ? parsed.filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
      : [];

    return {
      ok: true,
      error: null,
      raw_response: parsed,
      items,
    };
  } catch (err) {
    const isAbort = err instanceof Error && err.name === 'AbortError';
    return {
      ok: false,
      error: isAbort ? 'Apify timeout' : err instanceof Error ? err.message : String(err),
      raw_response: null,
      items: [],
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function extractWithApify(input: {
  url: string;
  sourceDomain: string;
  headline: string;
  query?: string;
}): Promise<ApifyExtractionResult> {
  const normalizedDomain = normalizeDomain(input.sourceDomain);

  if (normalizedDomain === 'bloomberg.com') {
    const result = await runActor(BLOOMBERG_ACTOR, { url: input.url });
    if (!result.ok) {
      return { ok: false, error: result.error, raw_response: result.raw_response, content: '', headline: '', url: input.url, item_count: 0 };
    }

    const best = pickBestItem(result.items, { url: input.url, headline: input.headline });
    if (!best) {
      return { ok: false, error: 'Apify returned no Bloomberg item', raw_response: result.raw_response, content: '', headline: '', url: input.url, item_count: result.items.length };
    }

    const content = extractItemText(best);
    return {
      ok: Boolean(content),
      error: content ? null : 'Bloomberg actor returned empty content',
      raw_response: result.raw_response,
      content,
      headline:
        typeof best.title === 'string'
          ? best.title
          : typeof best.headline === 'string'
          ? best.headline
          : input.headline,
      url:
        typeof best.url === 'string'
          ? best.url
          : typeof best.link === 'string'
          ? best.link
          : input.url,
      item_count: result.items.length,
    };
  }

  const result = await runActor(FAST_NEWS_ACTOR, {
    site: normalizedDomain,
    query: input.headline || input.query || normalizedDomain,
    maxItems: 5,
    sort: 'newest',
  });

  if (!result.ok) {
    return { ok: false, error: result.error, raw_response: result.raw_response, content: '', headline: '', url: input.url, item_count: 0 };
  }

  const best = pickBestItem(result.items, { url: input.url, headline: input.headline });
  if (!best) {
    return {
      ok: false,
      error: 'Apify returned no matching news item',
      raw_response: result.raw_response,
      content: '',
      headline: '',
      url: input.url,
      item_count: result.items.length,
    };
  }

  const content = extractItemText(best);
  return {
    ok: Boolean(content),
    error: content ? null : 'Fast News Scraper returned empty content',
    raw_response: result.raw_response,
    content,
    headline:
      typeof best.title === 'string'
        ? best.title
        : typeof best.headline === 'string'
        ? best.headline
        : input.headline,
    url:
      typeof best.url === 'string'
        ? best.url
        : typeof best.link === 'string'
        ? best.link
        : input.url,
    item_count: result.items.length,
  };
}
