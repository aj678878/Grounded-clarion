/* ------------------------------------------------------------------ */
/*  Tavily web search — used by the chat router for external context  */
/*                                                                    */
/*  Env: TAVILY_API_KEY (if unset → search is unavailable)            */
/* ------------------------------------------------------------------ */

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  source: string; // extracted domain
  score: number;  // credibility score (3 = official, 2 = major outlet, 1 = reference, 0 = other)
}

/* ---------- Domain credibility scoring ---------- */

const DOMAIN_SCORES: Record<string, number> = {
  // 3 — Government / official institutions
  'gov.uk': 3, 'parliament.uk': 3, 'congress.gov': 3, 'whitehouse.gov': 3,
  'europa.eu': 3, 'un.org': 3, 'imf.org': 3, 'worldbank.org': 3,
  'oecd.org': 3, 'wto.org': 3, 'who.int': 3,
  'federalreserve.gov': 3, 'ecb.europa.eu': 3, 'bankofengland.co.uk': 3,
  'rbi.org.in': 3, 'india.gov.in': 3, 'pib.gov.in': 3,

  // 2 — Major news outlets / wires
  'bbc.co.uk': 2, 'bbc.com': 2, 'reuters.com': 2, 'apnews.com': 2,
  'ft.com': 2, 'wsj.com': 2, 'economist.com': 2, 'theguardian.com': 2,
  'nytimes.com': 2, 'washingtonpost.com': 2, 'bloomberg.com': 2,
  'aljazeera.com': 2, 'politico.com': 2, 'politico.eu': 2,
  'cnbc.com': 2, 'thehindu.com': 2, 'indianexpress.com': 2,
  'ndtv.com': 2, 'livemint.com': 2,

  // 1 — Reliable reference
  'en.wikipedia.org': 1, 'wikipedia.org': 1, 'britannica.com': 1,
};

function scoreDomain(url: string): number {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, '');
    // Check exact match first, then progressively wider suffixes
    if (DOMAIN_SCORES[hostname] !== undefined) return DOMAIN_SCORES[hostname];
    // Check if it's a subdomain of a known domain (e.g. news.bbc.co.uk)
    for (const [domain, score] of Object.entries(DOMAIN_SCORES)) {
      if (hostname.endsWith('.' + domain) || hostname === domain) return score;
    }
    return 0;
  } catch {
    return 0;
  }
}

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/* ---------- Query enhancement ---------- */

const TITLE_STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'from', 'is', 'are', 'was', 'were', 'be', 'been',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'it', 'its', 'this', 'that', 'these', 'those',
  'as', 'if', 'not', 'no', 'so', 'too', 'very', 'just', 'about', 'after',
  'all', 'also', 'any', 'been', 'being', 'both', 'how', 'who', 'what',
  'when', 'where', 'why', 'which', 'they', 'them', 'their', 'we', 'our',
  'you', 'your', 'he', 'him', 'his', 'she', 'her', 'me', 'my', 'i',
  'says', 'said', 'new', 'over', 'more', 'up', 'out', 'into', 'than',
]);

/**
 * Extract 3–5 meaningful keywords from an article title (lowercase, no stopwords).
 */
function extractTitleKeywords(title: string): string[] {
  return title
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !TITLE_STOPWORDS.has(w))
    .slice(0, 5);
}

/**
 * Build an enhanced search query from suggested queries, article title, and user question.
 *
 * enhanced_query = base_query + " " + context_keywords + " authoritative source"
 * base_query = first suggested query (if available) else userQuestion
 */
export function enhanceSearchQuery(
  suggestedQueries: string[],
  articleTitle: string,
  userQuestion: string
): string[] {
  const baseQuery =
    suggestedQueries.length > 0 ? suggestedQueries[0] : userQuestion;

  const contextKeywords = extractTitleKeywords(articleTitle);
  const suffix = contextKeywords.length > 0
    ? ' ' + contextKeywords.join(' ') + ' authoritative source'
    : ' authoritative source';

  const enhanced = baseQuery + suffix;

  // Return the single enhanced query (plus the second suggested query if available, unmodified)
  const result = [enhanced];
  if (suggestedQueries.length > 1) {
    result.push(suggestedQueries[1]);
  }
  return result;
}

/* ---------- Tavily search ---------- */

const SEARCH_TIMEOUT_MS = 8_000;

/**
 * Search Tavily with 1–2 queries, merge & deduplicate results,
 * score by domain credibility, return top 3.
 */
export async function searchTavily(
  queries: string[]
): Promise<{ results: SearchResult[]; timedOut: boolean }> {
  const apiKey = process.env.TAVILY_API_KEY ?? '';
  if (!apiKey) {
    return { results: [], timedOut: false };
  }

  // Take at most 2 queries
  const toRun = queries.slice(0, 2);

  const timeout = new Promise<'TIMEOUT'>((resolve) =>
    setTimeout(() => resolve('TIMEOUT'), SEARCH_TIMEOUT_MS)
  );

  try {
    const searchPromises = toRun.map((q) =>
      fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_key: apiKey,
          query: q,
          max_results: 5,
          search_depth: 'advanced',
          exclude_domains: ['linkedin.com', 'quora.com', 'facebook.com', 'reddit.com', 'medium.com']
        }),
      }).then((r) => (r.ok ? r.json() : { results: [] }))
    );

    const raceResult = await Promise.race([
      Promise.all(searchPromises),
      timeout,
    ]);

    if (raceResult === 'TIMEOUT') {
      console.warn('[search] Tavily timed out after', SEARCH_TIMEOUT_MS, 'ms');
      return { results: [], timedOut: true };
    }

    // Merge results from all queries
    const allResults: SearchResult[] = [];
    const seenUrls = new Set<string>();

    for (const data of raceResult) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const r of (data.results ?? [])) {
        const url = r.url ?? '';
        if (seenUrls.has(url)) continue;
        seenUrls.add(url);

        allResults.push({
          title: r.title ?? '',
          url,
          snippet: r.content ?? '',
          source: extractDomain(url),
          score: scoreDomain(url),
        });
      }
    }

    // Sort by credibility score (desc), take top 3
    allResults.sort((a, b) => b.score - a.score);
    return { results: allResults.slice(0, 3), timedOut: false };
  } catch (err) {
    console.error('[search] Tavily error:', err);
    return { results: [], timedOut: false };
  }
}

/* ---------- Check if Tavily is configured ---------- */

export function isSearchAvailable(): boolean {
  return Boolean(process.env.TAVILY_API_KEY);
}

/* ---------- Format results for LLM context ---------- */

export function formatSearchResultsForLLM(results: SearchResult[]): string {
  if (results.length === 0) return '';

  const lines = results.map(
    (r, i) =>
      `[${i + 1}] "${r.title}" — ${r.source}\n    URL: ${r.url}\n    ${r.snippet}`
  );

  return (
    '=== WEB SEARCH RESULTS (use for "Additional context" section; cite URL when referencing) ===\n\n' +
    lines.join('\n\n')
  );
}
