/* ------------------------------------------------------------------ */
/*  Web search module — Tavily / SerpAPI / none                       */
/*  Used by /api/chat to fetch external context when the article      */
/*  doesn't contain enough information to answer the user's question. */
/* ------------------------------------------------------------------ */

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  source: string; // domain or publisher name
}

/* ---------- Detect if a question likely needs external context ---------- */

const CONTEXT_PATTERNS = [
  /\bwhat is\b/i, /\bwhat are\b/i, /\bwhat was\b/i, /\bwhat were\b/i,
  /\bwho is\b/i, /\bwho are\b/i, /\bwho was\b/i, /\bwho were\b/i,
  /\bexplain\b/i, /\bdefine\b/i, /\bdefinition\b/i,
  /\bbackground\b/i, /\bagenda\b/i, /\bhistory of\b/i,
  /\bwhy does\b/i, /\bwhy do\b/i, /\bwhy is\b/i, /\bwhy did\b/i, /\bwhy are\b/i,
  /\bwhat does .+ mean\b/i, /\bwhat.+stand for\b/i,
  /\btell me (?:more )?about\b/i, /\bmore context\b/i, /\bmore information\b/i,
  /\bwhat happened\b/i, /\bhow does .+ work\b/i, /\bhow do .+ work\b/i,
  /\brole of\b/i, /\bpurpose of\b/i, /\bmeaning of\b/i,
  /\bsignificance\b/i, /\bimplications?\b/i, /\bconsequences?\b/i,
  /\bwhat led to\b/i, /\bwhat caused\b/i, /\bwhat.+about\b/i,
  /\bcan you explain\b/i, /\bi don'?t understand\b/i,
];

export function needsExternalContext(question: string): boolean {
  return CONTEXT_PATTERNS.some((p) => p.test(question));
}

/* ---------- Provider: Tavily ---------- */

async function searchTavily(query: string, apiKey: string): Promise<SearchResult[]> {
  const res = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      max_results: 5,
      search_depth: 'basic',
    }),
  });

  if (!res.ok) {
    console.error('[search/tavily] HTTP', res.status);
    return [];
  }

  const data = await res.json();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data.results ?? []).map((r: any) => ({
    title: r.title ?? '',
    url: r.url ?? '',
    snippet: r.content ?? '',
    source: extractDomain(r.url ?? ''),
  }));
}

/* ---------- Provider: SerpAPI ---------- */

async function searchSerpApi(query: string, apiKey: string): Promise<SearchResult[]> {
  const params = new URLSearchParams({
    engine: 'google',
    q: query,
    api_key: apiKey,
    num: '5',
  });

  const res = await fetch(`https://serpapi.com/search.json?${params}`);

  if (!res.ok) {
    console.error('[search/serpapi] HTTP', res.status);
    return [];
  }

  const data = await res.json();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data.organic_results ?? []).slice(0, 5).map((r: any) => ({
    title: r.title ?? '',
    url: r.link ?? '',
    snippet: r.snippet ?? '',
    source: extractDomain(r.link ?? ''),
  }));
}

/* ---------- Unified search entry point ---------- */

const SEARCH_TIMEOUT_MS = 8_000; // 8-second hard timeout for the search phase

/**
 * Search the web for additional context.
 * Returns results, or empty array if provider is "none", unconfigured, or timeout.
 * `searchTimedOut` is true if we ran out of time — the caller should tell the user.
 */
export async function searchWeb(
  query: string
): Promise<{ results: SearchResult[]; searchTimedOut: boolean; provider: string }> {
  const provider = (process.env.SEARCH_PROVIDER ?? 'none').toLowerCase();
  const apiKey = process.env.SEARCH_API_KEY ?? '';

  if (provider === 'none' || !apiKey) {
    return { results: [], searchTimedOut: false, provider: 'none' };
  }

  const searchFn =
    provider === 'tavily' ? searchTavily
    : provider === 'serpapi' ? searchSerpApi
    : null;

  if (!searchFn) {
    console.warn(`[search] Unknown SEARCH_PROVIDER: ${provider}`);
    return { results: [], searchTimedOut: false, provider };
  }

  // Race against timeout
  const timeout = new Promise<'TIMEOUT'>((resolve) =>
    setTimeout(() => resolve('TIMEOUT'), SEARCH_TIMEOUT_MS)
  );

  try {
    const raceResult = await Promise.race([searchFn(query, apiKey), timeout]);

    if (raceResult === 'TIMEOUT') {
      console.warn('[search] Timed out after', SEARCH_TIMEOUT_MS, 'ms');
      return { results: [], searchTimedOut: true, provider };
    }

    return { results: raceResult, searchTimedOut: false, provider };
  } catch (err) {
    console.error('[search] Error:', err);
    return { results: [], searchTimedOut: false, provider };
  }
}

/* ---------- Helpers ---------- */

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/**
 * Format search results into a text block suitable for the LLM context window.
 */
export function formatSearchResultsForLLM(results: SearchResult[]): string {
  if (results.length === 0) return '';

  const lines = results.map(
    (r, i) =>
      `[${i + 1}] "${r.title}" — ${r.source}\n    URL: ${r.url}\n    ${r.snippet}`
  );

  return (
    '=== WEB SEARCH RESULTS (use these for additional context; cite URL when referencing) ===\n\n' +
    lines.join('\n\n')
  );
}
