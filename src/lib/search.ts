/* ------------------------------------------------------------------ */
/*  Tavily web search — used by the chat router for external context  */
/*                                                                    */
/*  Env: TAVILY_API_KEY (if unset → search is unavailable)            */
/*       SEARCH_DEBUG=1  → write per-search debug log                 */
/*                                                                    */
/*  Pipeline:                                                         */
/*    1. Tavily API (max_results=10, advanced depth)                  */
/*    2. Local blocklist + canonical-URL dedup                        */
/*    3. Blended ranking (0.65 credibility + 0.35 relevance)          */
/*    4. Top 5 selected → full-text extraction via Readability        */
/*    5. Fallback to snippet when extraction fails / paywall          */
/*    6. Per-source content capped at 2500 chars; total 12 000 chars  */
/* ------------------------------------------------------------------ */

import * as fs from 'fs';
import * as path from 'path';

/* ================================================================== */
/*  Public types                                                      */
/* ================================================================== */

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;   // original Tavily snippet (always present)
  content: string;    // enriched full text OR snippet fallback
  source: string;     // extracted domain
  score: number;      // credibility score (3 = official, 2 = major outlet, 1 = reference, 0 = other)
  extractionOk?: boolean; // true if full-text extraction succeeded
}

export function asString(x: unknown): string {
  return typeof x === 'string' ? x : '';
}

export function hasUrl(u: unknown): u is string {
  return typeof u === 'string' && u.startsWith('http');
}

/* ================================================================== */
/*  Domain credibility scoring                                        */
/* ================================================================== */

export const DOMAIN_SCORES: Record<string, number> = {
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

/** Blocked domains — always excluded even if Tavily returns them. */
const BLOCKED_DOMAINS = new Set([
  'facebook.com', 'm.facebook.com', 'web.facebook.com',
  'quora.com',
  'reddit.com', 'old.reddit.com',
  'linkedin.com',
  'medium.com',
  'pinterest.com',
  'tiktok.com',
]);

export function getHostname(url: unknown): string {
  if (!hasUrl(url)) return '';
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

export function scoreDomain(url: unknown): number {
  const hostname = getHostname(url);
  if (!hostname) return 0;
  if (DOMAIN_SCORES[hostname] !== undefined) return DOMAIN_SCORES[hostname];
  for (const [domain, score] of Object.entries(DOMAIN_SCORES)) {
    if (hostname.endsWith('.' + domain) || hostname === domain) return score;
  }
  return 0;
}

export function extractDomain(url: unknown): string {
  const safeUrl = asString(url);
  return getHostname(safeUrl) || safeUrl;
}

/** Is this hostname (or any parent) on the blocklist? */
export function isBlocked(url: unknown): boolean {
  const hostname = getHostname(url);
  if (!hostname) return false;
  if (BLOCKED_DOMAINS.has(hostname)) return true;
  const blockedArr = Array.from(BLOCKED_DOMAINS);
  for (let i = 0; i < blockedArr.length; i++) {
    if (hostname.endsWith('.' + blockedArr[i])) return true;
  }
  return false;
}

/* ================================================================== */
/*  Tokenizer + Jaccard (for relevance scoring)                       */
/* ================================================================== */

const RELEVANCE_STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'from', 'is', 'are', 'was', 'were', 'be', 'been',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'it', 'its', 'this', 'that', 'these', 'those',
  'as', 'if', 'not', 'no', 'so', 'too', 'very', 'just', 'about', 'after',
  'all', 'also', 'any', 'been', 'being', 'both', 'how', 'who', 'what',
  'when', 'where', 'why', 'which', 'they', 'them', 'their', 'we', 'our',
  'you', 'your', 'he', 'him', 'his', 'she', 'her', 'me', 'my', 'i',
  'says', 'said', 'new', 'over', 'more', 'up', 'out', 'into', 'than',
  'can', 'get', 'got', 'like', 'one', 'two', 'first', 'use', 'used',
]);

const SHORT_SIGNAL_TOKENS = new Set([
  'ai', 'uk', 'us', 'eu', 'un',
]);

function normalizeToken(token: string): string {
  let t = token;
  if (t.endsWith("'s")) t = t.slice(0, -2);
  if (t.endsWith('ies') && t.length > 4) return t.slice(0, -3) + 'y';
  if (t.endsWith('s') && t.length > 4 && !t.endsWith('ss')) return t.slice(0, -1);
  return t;
}

export function tokenize(text: unknown): Set<string> {
  const tokens = asString(text)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map(normalizeToken)
    .filter((t) =>
      (t.length >= 3 || SHORT_SIGNAL_TOKENS.has(t)) &&
      !RELEVANCE_STOPWORDS.has(t)
    );
  return new Set(tokens);
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let intersection = 0;
  const [smaller, larger] = a.size <= b.size ? [a, b] : [b, a];
  smaller.forEach((token) => { if (larger.has(token)) intersection++; });
  const union = a.size + b.size - intersection;
  return union > 0 ? intersection / union : 0;
}

function buildPhraseSet(text: unknown): Set<string> {
  const words = asString(text)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map(normalizeToken)
    .filter((w) => (w.length >= 3 || SHORT_SIGNAL_TOKENS.has(w)) && !RELEVANCE_STOPWORDS.has(w));

  const phrases = new Set<string>();
  for (let i = 0; i < words.length - 1; i++) {
    phrases.add(`${words[i]} ${words[i + 1]}`);
  }
  return phrases;
}

function blendRelevance(question: unknown, resultText: unknown): number {
  const qSet = tokenize(question);
  const rSet = tokenize(resultText);
  if (qSet.size === 0 || rSet.size === 0) return 0;

  let overlap = 0;
  qSet.forEach((t) => {
    if (rSet.has(t)) overlap++;
  });
  const recall = overlap / qSet.size;
  const jac = jaccard(qSet, rSet);

  const qPhrases = buildPhraseSet(question);
  const rPhrases = buildPhraseSet(resultText);
  let phraseOverlap = 0;
  qPhrases.forEach((p) => {
    if (rPhrases.has(p)) phraseOverlap++;
  });
  const phraseRecall = qPhrases.size > 0 ? phraseOverlap / qPhrases.size : 0;

  return Math.min(1, 0.5 * recall + 0.35 * jac + 0.15 * phraseRecall);
}

/* ================================================================== */
/*  URL canonicalization + dedup                                      */
/* ================================================================== */

const STRIP_PARAMS = new Set([
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
  'ref', 'fbclid', 'gclid', 'mc_cid', 'mc_eid', 'msclkid', 'twclid',
]);

export function canonicalizeUrl(rawUrl: string): string {
  if (!hasUrl(rawUrl)) return '';
  try {
    const u = new URL(rawUrl);
    const params = new URLSearchParams(u.search);
    const keysToDelete: string[] = [];
    params.forEach((_, key) => {
      if (STRIP_PARAMS.has(key.toLowerCase())) keysToDelete.push(key);
    });
    keysToDelete.forEach((k) => params.delete(k));
    u.search = params.toString();
    let out = u.toString();
    if (out.endsWith('/') && u.pathname !== '/') out = out.slice(0, -1);
    return out;
  } catch {
    return rawUrl;
  }
}

/* ================================================================== */
/*  Query enhancement                                                 */
/* ================================================================== */

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

function extractTitleKeywords(title: string): string[] {
  return title
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !TITLE_STOPWORDS.has(w))
    .slice(0, 5);
}

function extractQuestionKeywords(question: string): string[] {
  return Array.from(tokenize(question)).slice(0, 6);
}

export function enhanceSearchQuery(
  suggestedQueries: string[],
  articleTitle: string,
  userQuestion: string
): string[] {
  const baseQuery =
    suggestedQueries.length > 0 ? suggestedQueries[0] : userQuestion;

  const contextKeywords = extractTitleKeywords(articleTitle);
  const questionKeywords = extractQuestionKeywords(userQuestion);
  const mergedKeywords = Array.from(new Set([...contextKeywords, ...questionKeywords])).slice(0, 8);
  const suffix = mergedKeywords.length > 0
    ? ' ' + mergedKeywords.join(' ') + ' authoritative source'
    : ' authoritative source';

  const enhanced = baseQuery + suffix;

  const result = [enhanced];
  if (suggestedQueries.length > 1) {
    result.push(suggestedQueries[1]);
  } else if (userQuestion.trim()) {
    const questionFirstQuery = `${userQuestion} ${contextKeywords.slice(0, 3).join(' ')} authoritative source`.trim();
    result.push(questionFirstQuery);
  }
  return result;
}

/* ================================================================== */
/*  Full-text extraction (Readability + JSDOM)                        */
/* ================================================================== */

const EXTRACT_TIMEOUT_MS = 4_000;
const MIN_EXTRACTED_CHARS = 800;
const PER_SOURCE_MAX_CHARS = 2_500;
const TOTAL_CONTEXT_MAX_CHARS = 12_000;

const PAYWALL_SIGNALS = [
  'subscribe to continue',
  'sign in to read',
  'create a free account',
  "you've reached your limit",
  'this article is for subscribers',
  'already a subscriber',
  'premium content',
  'unlock this article',
];

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
};

type ReadabilityDeps = {
  JSDOMCtor: typeof import('jsdom').JSDOM;
  ReadabilityCtor: typeof import('@mozilla/readability').Readability;
};

let readabilityDeps: ReadabilityDeps | null = null;
let readabilityDepsLoadFailed = false;

async function getReadabilityDeps(): Promise<ReadabilityDeps | null> {
  if (readabilityDeps) return readabilityDeps;
  if (readabilityDepsLoadFailed) return null;

  try {
    const [{ JSDOM }, { Readability }] = await Promise.all([
      import('jsdom'),
      import('@mozilla/readability'),
    ]);
    readabilityDeps = {
      JSDOMCtor: JSDOM,
      ReadabilityCtor: Readability,
    };
    return readabilityDeps;
  } catch (err) {
    readabilityDepsLoadFailed = true;
    console.warn('[search] Readability deps unavailable, using snippet-only fallback:', err);
    return null;
  }
}

/**
 * Fetch a URL and extract readable text using Readability.
 * Returns null if extraction fails (blocked, paywall, too short, timeout).
 */
export async function fetchAndExtractReadableText(url: string): Promise<string | null> {
  const deps = await getReadabilityDeps();
  if (!deps) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), EXTRACT_TIMEOUT_MS);

  try {
    const resp = await fetch(url, {
      headers: BROWSER_HEADERS,
      signal: controller.signal,
      redirect: 'follow',
    });

    if (!resp.ok) return null;

    const contentType = resp.headers.get('content-type') ?? '';
    if (!contentType.includes('text/html') && !contentType.includes('application/xhtml')) {
      return null;
    }

    const html = await resp.text();
    if (!html || html.length < 500) return null;

    const dom = new deps.JSDOMCtor(html, { url });
    const reader = new deps.ReadabilityCtor(dom.window.document);
    const article = reader.parse();

    if (!article || !article.textContent) return null;

    const text = article.textContent.trim();

    // Too short → likely paywall or failed extraction
    if (text.length < MIN_EXTRACTED_CHARS) return null;

    // Paywall detection
    const lower = text.toLowerCase();
    for (const signal of PAYWALL_SIGNALS) {
      // Only treat as paywall if the signal appears AND the text is suspiciously short
      if (lower.includes(signal) && text.length < 1500) return null;
    }

    return text;
  } catch {
    // Timeout, network error, parse error — all treated as failure
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * For each result, attempt full-text extraction. Fall back to snippet.
 * Truncate per-source content to PER_SOURCE_MAX_CHARS.
 * Stop enriching once TOTAL_CONTEXT_MAX_CHARS is reached.
 */
async function enrichWithFullText(
  results: SearchResult[]
): Promise<SearchResult[]> {
  let totalChars = 0;

  // Fetch all in parallel (each has its own 4s timeout)
  const extractions = await Promise.allSettled(
    results.map((r) => fetchAndExtractReadableText(r.url))
  );

  const enriched: SearchResult[] = [];

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const extraction = extractions[i];
    let fullText: string | null = null;

    if (extraction.status === 'fulfilled') {
      fullText = extraction.value;
    }

    let content: string;
    let extractionOk: boolean;

    if (fullText && totalChars + Math.min(fullText.length, PER_SOURCE_MAX_CHARS) <= TOTAL_CONTEXT_MAX_CHARS) {
      content = fullText.slice(0, PER_SOURCE_MAX_CHARS);
      extractionOk = true;
    } else if (fullText && totalChars < TOTAL_CONTEXT_MAX_CHARS) {
      // Fit what we can
      const remaining = TOTAL_CONTEXT_MAX_CHARS - totalChars;
      content = fullText.slice(0, Math.min(remaining, PER_SOURCE_MAX_CHARS));
      extractionOk = true;
    } else {
      // Fallback to snippet
      const snippetTruncated = r.snippet.slice(0, PER_SOURCE_MAX_CHARS);
      content = snippetTruncated;
      extractionOk = false;
    }

    totalChars += content.length;

    enriched.push({
      ...r,
      content,
      extractionOk,
    });

    if (totalChars >= TOTAL_CONTEXT_MAX_CHARS) {
      // Still add remaining results with snippet fallback but no more full text
      for (let j = i + 1; j < results.length; j++) {
        const remaining = results[j];
        enriched.push({
          ...remaining,
          content: remaining.snippet.slice(0, PER_SOURCE_MAX_CHARS),
          extractionOk: false,
        });
      }
      break;
    }
  }

  return enriched;
}

/* ================================================================== */
/*  Debug logging                                                     */
/* ================================================================== */

const SEARCH_DEBUG = process.env.SEARCH_DEBUG === '1';
const DEBUG_LOG_PATH = path.resolve(process.cwd(), 'logs', 'search_debug.log');

interface DebugCandidate {
  domain: string;
  title: string;
  canonicalUrl: string;
  domainCredScore: number;
  relevanceScore: number;
  blendedScore: number;
  blocked: boolean;
}

interface DebugSelected {
  domain: string;
  url: string;
  extractionOk: boolean;
  extractedLength: number;
  snippetLength: number;
  blendedScore: number;
}

function writeDebugLog(entry: {
  timestamp: string;
  userQuestion: string;
  queries: string[];
  candidates: DebugCandidate[];
  selected: DebugSelected[];
}) {
  if (!SEARCH_DEBUG) return;
  try {
    const dir = path.dirname(DEBUG_LOG_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const line = JSON.stringify(entry) + '\n';
    fs.appendFileSync(DEBUG_LOG_PATH, line, 'utf-8');
  } catch (err) {
    console.warn('[search-debug] Failed to write log:', err);
  }
}

function debugLog(...args: unknown[]) {
  if (SEARCH_DEBUG) console.log('[search-debug]', ...args);
}

/* ================================================================== */
/*  Tavily search                                                     */
/* ================================================================== */

const SEARCH_TIMEOUT_MS = 8_000;
const TOP_N = 5;

/**
 * Search Tavily with 1–2 queries, merge & deduplicate results,
 * rank by blended score (domain cred + relevance), select top 5,
 * then enrich with full-text extraction.
 *
 * @param queries       Enhanced search queries (1–2)
 * @param userQuestion  Original user question (for relevance scoring)
 */
export async function searchTavily(
  queries: string[],
  userQuestion: string = ''
): Promise<{ results: SearchResult[]; timedOut: boolean }> {
  const apiKey = process.env.TAVILY_API_KEY ?? '';
  if (!apiKey) {
    return { results: [], timedOut: false };
  }

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
          max_results: 10,
          search_depth: 'advanced',
          exclude_domains: ['linkedin.com', 'quora.com', 'facebook.com', 'reddit.com', 'medium.com'],
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

    // ---- Merge + canonicalize + local blocklist + dedupe ----
    const seenCanonical = new Set<string>();
    const debugCandidates: DebugCandidate[] = [];

    interface ScoredResult {
      title: string;
      url: string;
      snippet: string;
      source: string;
      score: number;
      relevanceScore: number;
      blendedScore: number;
    }

    const allResults: ScoredResult[] = [];

    for (const data of raceResult) {
      for (const r of (data.results ?? [])) {
        if (!hasUrl((r as { url?: unknown }).url)) {
          if (SEARCH_DEBUG) {
            debugLog('Skipping Tavily result due to missing/invalid URL', {
              title: asString((r as { title?: unknown }).title).slice(0, 80),
            });
          }
          continue;
        }
        const rawUrl = asString((r as { url?: unknown }).url);

        const canonical = canonicalizeUrl(rawUrl);
        const blocked = isBlocked(rawUrl);
        const domainCredScore = scoreDomain(rawUrl);

        const title = asString((r as { title?: unknown }).title);
        const snippet = asString(
          (r as { snippet?: unknown; content?: unknown; description?: unknown }).snippet ??
          (r as { snippet?: unknown; content?: unknown; description?: unknown }).content ??
          (r as { snippet?: unknown; content?: unknown; description?: unknown }).description
        );
        const resultText = `${title} ${snippet}`;
        const relevanceScore = userQuestion
          ? blendRelevance(userQuestion, resultText)
          : 0;

        const normalizedDomain = domainCredScore / 3;
        const blendedScore = 0.65 * normalizedDomain + 0.35 * relevanceScore;

        if (SEARCH_DEBUG) {
          debugCandidates.push({
            domain: extractDomain(rawUrl),
            title: title.slice(0, 80),
            canonicalUrl: canonical.slice(0, 120),
            domainCredScore,
            relevanceScore: Math.round(relevanceScore * 1000) / 1000,
            blendedScore: Math.round(blendedScore * 1000) / 1000,
            blocked,
          });
        }

        if (blocked) continue;
        if (seenCanonical.has(canonical)) continue;
        seenCanonical.add(canonical);

        allResults.push({
          title,
          url: rawUrl,
          snippet,
          source: extractDomain(rawUrl),
          score: domainCredScore,
          relevanceScore,
          blendedScore,
        });
      }
    }

    // ---- Sort by blendedScore desc, take top N ----
    allResults.sort((a, b) => b.blendedScore - a.blendedScore);
    const selected = allResults.slice(0, TOP_N);

    debugLog(`${allResults.length} candidates → ${selected.length} selected (blended ranking)`);

    // ---- Full-text extraction for selected results ----
    const baseResults: SearchResult[] = selected.map((s) => ({
      title: s.title,
      url: s.url,
      snippet: s.snippet,
      content: s.snippet, // will be overwritten by enrichment
      source: s.source,
      score: s.score,
    }));

    const enrichedResults = await enrichWithFullText(baseResults);

    // ---- Debug log ----
    if (SEARCH_DEBUG) {
      const debugSelected: DebugSelected[] = enrichedResults.map((r) => ({
        domain: r.source,
        url: r.url.slice(0, 120),
        extractionOk: r.extractionOk ?? false,
        extractedLength: r.content.length,
        snippetLength: r.snippet.length,
        blendedScore: Math.round(
          (selected.find((s) => s.url === r.url)?.blendedScore ?? 0) * 1000
        ) / 1000,
      }));

      writeDebugLog({
        timestamp: new Date().toISOString(),
        userQuestion: userQuestion.slice(0, 200),
        queries: toRun.map((q) => q.slice(0, 200)),
        candidates: debugCandidates,
        selected: debugSelected,
      });

      for (const ds of debugSelected) {
        debugLog(
          `  ${ds.domain} | blend=${ds.blendedScore} | extract=${ds.extractionOk ? 'OK' : 'FAIL'} ` +
          `| ${ds.extractionOk ? ds.extractedLength + ' chars' : 'snippet ' + ds.snippetLength + ' chars'}`
        );
      }
    }

    return { results: enrichedResults, timedOut: false };
  } catch (err) {
    console.error('[search] Tavily error:', err);
    return { results: [], timedOut: false };
  }
}

/* ================================================================== */
/*  Utility exports                                                   */
/* ================================================================== */

export function isSearchAvailable(): boolean {
  return Boolean(process.env.TAVILY_API_KEY);
}

/**
 * Format enriched search results for LLM context.
 * Uses full extracted text when available, snippet as fallback.
 */
export function formatSearchResultsForLLM(results: SearchResult[]): string {
  if (results.length === 0) return '';

  const blocks = results.map((r, i) => {
    const title = asString(r.title);
    const source = asString(r.source);
    const url = asString(r.url);
    const snippet = asString(r.snippet);
    const contentRaw = asString(r.content);
    const content = contentRaw || snippet || '(No extractable text available)';
    const tag = r.extractionOk ? '' : ' (snippet)';
    return (
      `[${i + 1}] "${title}" — ${source}${tag}\n` +
      `    URL: ${url}\n` +
      `    CONTENT:\n` +
      `    ${content.replace(/\n/g, '\n    ')}`
    );
  });

  return (
    '=== WEB CONTEXT (open-web extracts when available; otherwise snippet fallback) ===\n\n' +
    blocks.join('\n\n')
  );
}
