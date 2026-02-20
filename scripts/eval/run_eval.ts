#!/usr/bin/env tsx
/* ------------------------------------------------------------------ */
/*  run_eval.ts — Hardened evaluation harness for Clarion chat        */
/*                                                                    */
/*  Reads dataset.jsonl, runs the full pipeline (router → search →    */
/*  answer) for each case, then runs 3 LLM judges. Writes results    */
/*  to eval_results.json and eval_summary.md.                        */
/*                                                                    */
/*  MEASUREMENT ONLY — no behavior changes to the pipeline.          */
/*                                                                    */
/*  Uses Anthropic (Claude) via shared LLM provider with:            */
/*  - Global rate limiter (13s min between calls, 5 RPM safe)        */
/*  - Exponential backoff on 429 / 503 / ETIMEDOUT / ECONNRESET      */
/*  - Per-case error isolation (never crashes the whole run)          */
/*  - File-based cache to avoid redundant API calls on reruns        */
/*  - Resumability from partial results                               */
/* ------------------------------------------------------------------ */

import { config } from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

// Load .env.local BEFORE any other imports that read env vars
config({ path: path.resolve(process.cwd(), '.env.local') });

// Now import LLM utilities — they read env vars lazily inside functions
import {
  callAnthropic,
  withRetry,
  safeParseJson,
  getMinDelayMs,
  type SafeParseResult,
  type RetryOpts,
} from '../../src/lib/llm/index';

/* ================================================================== */
/*  Config                                                            */
/* ================================================================== */

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY ?? '';
const TAVILY_API_KEY = process.env.TAVILY_API_KEY ?? '';

const MODEL_ROUTER = process.env.MODEL_ROUTER ?? 'claude-3-haiku-20240307';
const MODEL_TUTOR = process.env.MODEL_TUTOR ?? 'claude-3-haiku-20240307';
const MODEL_JUDGE = process.env.MODEL_JUDGE ?? 'claude-3-haiku-20240307';

const DATASET_PATH = path.resolve(
  process.cwd(),
  process.env.EVAL_DATASET_PATH || 'scripts/eval/dataset.jsonl',
);
const RESULTS_PATH = path.resolve(process.cwd(), 'scripts/eval/eval_results.json');
const PARTIAL_PATH = path.resolve(process.cwd(), 'scripts/eval/eval_results.partial.json');
const SUMMARY_PATH = path.resolve(process.cwd(), 'scripts/eval/eval_summary.md');
const CACHE_DIR = path.resolve(process.cwd(), 'scripts/eval/.cache');

const EVAL_THROTTLE_MS = parseInt(process.env.EVAL_THROTTLE_MS ?? '800', 10);
const EVAL_CACHE = (process.env.EVAL_CACHE ?? '1') === '1';
const EVAL_RESUME = (process.env.EVAL_RESUME ?? '1') === '1';

const BAD_DOMAINS = ['quora.com', 'facebook.com', 'reddit.com', 'medium.com', 'blogspot.com'];
const LOW_CRED_DOMAINS = ['linkedin.com', 'quora.com', 'facebook.com', 'reddit.com', 'medium.com'];

const MAX_EXCERPT_CHARS = 12_000;

/* ---- Stopwords for Jaccard tokenizer ---- */

const STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'from', 'is', 'are', 'was', 'were', 'be', 'been',
  'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
  'could', 'should', 'may', 'might', 'shall', 'can', 'need', 'dare',
  'ought', 'used', 'it', 'its', 'this', 'that', 'these', 'those',
  'i', 'me', 'my', 'we', 'our', 'you', 'your', 'he', 'him', 'his',
  'she', 'her', 'they', 'them', 'their', 'what', 'which', 'who',
  'whom', 'where', 'when', 'why', 'how', 'not', 'no', 'nor',
  'as', 'if', 'then', 'than', 'too', 'very', 'so', 'just',
  'about', 'above', 'after', 'again', 'all', 'also', 'am', 'any',
  'because', 'before', 'below', 'between', 'both', 'during', 'each',
  'few', 'further', 'get', 'got', 'here', 'into', 'more', 'most',
  'other', 'out', 'over', 'own', 'same', 'some', 'such', 'through',
  'under', 'until', 'up', 'while',
]);

/* ================================================================== */
/*  Types                                                             */
/* ================================================================== */

interface DatasetCase {
  case_id: string;
  article_id: string;
  article_title: string;
  article_text?: string;
  article_excerpt?: string;
  question: string;
  expected_should_search: string; // "yes" | "no"
}

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  source: string;
  score: number;
}

interface CitationAnalysis {
  has_markdown_link: boolean;
  has_url_anywhere: boolean;
  has_inline_source_tags: boolean;
  has_sources_section_near_end: boolean;
  sources_section_has_url: boolean;
  end_sources_with_url: boolean;
}

interface EvalResult {
  case_id: string;
  article_id: string;
  article_title: string;
  question: string;
  expected_should_search: string;

  // Pipeline
  router_need_web: boolean | null;
  router_reason: string;
  search_called: boolean;
  sources_used: string[];
  citations_present: boolean;
  latency_total_ms: number;
  answer_text: string;

  // Deterministic metrics
  search_compliance: boolean;
  citation_coverage: boolean;
  bad_domains_present: boolean;
  bad_domains: string[];

  // Citation analysis
  has_markdown_link: boolean;
  has_url_anywhere: boolean;
  has_inline_source_tags: boolean;
  has_sources_section_near_end: boolean;
  sources_section_has_url: boolean;
  end_sources_with_url: boolean;

  // Retrieval alignment (Jaccard)
  alignment_score: number | null;
  low_alignment: boolean;

  // Low-cred domain ratio
  low_cred_count: number;
  total_results: number;
  low_cred_ratio: number;
  low_cred_dominant: boolean;

  // LLM judges (nullable on parse failure)
  should_search_correct: boolean | null;
  should_search_reasoning: string;
  completeness_score: number | null;
  completeness_reasoning: string;
  unsupported_claims: boolean | null;
  unsupported_explanation: string;

  // Judge parse diagnostics
  judge_raw_output: string;
  judge_parse_ok: boolean;
  judge_parse_error: string;

  // Error tracking
  pipeline_error: string | null;
}

/* ================================================================== */
/*  File-based cache                                                  */
/* ================================================================== */

function cacheKey(...parts: string[]): string {
  return crypto.createHash('sha256').update(parts.join('||')).digest('hex').slice(0, 16);
}

function cacheGet(namespace: string, key: string): string | null {
  if (!EVAL_CACHE) return null;
  const file = path.join(CACHE_DIR, namespace, `${key}.json`);
  try {
    if (fs.existsSync(file)) return fs.readFileSync(file, 'utf-8');
  } catch {}
  return null;
}

function cacheSet(namespace: string, key: string, value: string): void {
  if (!EVAL_CACHE) return;
  const dir = path.join(CACHE_DIR, namespace);
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${key}.json`), value);
  } catch {}
}

/* ================================================================== */
/*  Utilities                                                         */
/* ================================================================== */

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Normalise article text from dataset — handles article_text or article_excerpt. */
function getArticleText(c: DatasetCase): string {
  const raw = c.article_text || c.article_excerpt || '';
  return raw.slice(0, MAX_EXCERPT_CHARS);
}

/** Detect citations: at least one markdown link [text](url). */
function hasCitations(text: string): boolean {
  return /\[.+?\]\(https?:\/\/.+?\)/.test(text);
}

/** Analyze citation quality in answer text. */
function analyzeCitations(text: string): CitationAnalysis {
  const has_markdown_link = /\[.+?\]\(https?:\/\/.+?\)/.test(text);
  const has_url_anywhere = /https?:\/\/\S+/.test(text);
  const has_inline_source_tags =
    /\[Source:\s*.+?\]/i.test(text) || /\bSource:\s*\w+/i.test(text);

  // Find last occurrence of Sources/Source/References header
  const headerPattern = /(?:^|\n)\s*\**(?:Sources|Source|References)\**\s*:?/gi;
  let lastHeaderIndex = -1;
  let match: RegExpExecArray | null;
  while ((match = headerPattern.exec(text)) !== null) {
    lastHeaderIndex = match.index;
  }

  let has_sources_section_near_end = false;
  let sources_section_has_url = false;

  if (lastHeaderIndex >= 0) {
    has_sources_section_near_end = lastHeaderIndex >= text.length * 0.7;
    if (has_sources_section_near_end) {
      const sectionText = text.slice(lastHeaderIndex);
      sources_section_has_url = /https?:\/\/\S+/.test(sectionText);
    }
  }

  const end_sources_with_url = has_sources_section_near_end && sources_section_has_url;

  return {
    has_markdown_link,
    has_url_anywhere,
    has_inline_source_tags,
    has_sources_section_near_end,
    sources_section_has_url,
    end_sources_with_url,
  };
}

/** Extract 3–5 meaningful keywords from an article title (lowercase, no stopwords). */
function extractTitleKeywords(title: string): string[] {
  return title
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w))
    .slice(0, 5);
}

/**
 * Build an enhanced search query:
 *   base_query + " " + title_keywords + " authoritative source"
 */
function buildEnhancedQueries(
  suggestedQueries: string[],
  articleTitle: string,
  userQuestion: string
): string[] {
  const baseQuery = suggestedQueries.length > 0 ? suggestedQueries[0] : userQuestion;
  const contextKeywords = extractTitleKeywords(articleTitle);
  const suffix =
    contextKeywords.length > 0
      ? ' ' + contextKeywords.join(' ') + ' authoritative source'
      : ' authoritative source';
  const enhanced = baseQuery + suffix;

  const result = [enhanced];
  if (suggestedQueries.length > 1) {
    result.push(suggestedQueries[1]);
  }
  return result;
}

/** Tokenize text for Jaccard: lowercase, remove punctuation, remove stopwords, unique tokens. */
function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 1 && !STOPWORDS.has(t))
  );
}

/** Jaccard similarity between two token sets. */
function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let intersection = 0;
  Array.from(a).forEach((t) => {
    if (b.has(t)) intersection++;
  });
  const union = a.size + b.size - intersection;
  return union > 0 ? intersection / union : 0;
}

/** Default retry opts for eval (2s → 4s → 8s, 3 attempts). */
const RETRY_OPTS: Partial<RetryOpts> = {
  baseDelayMs: 2000,
  backoffMultiplier: 2,
  maxAttempts: 3,
};

/* ================================================================== */
/*  Pipeline — router → search → answer                              */
/* ================================================================== */

/* --- Router --- */

const ROUTER_PROMPT = `You are a routing assistant. Given a news article and a user question, decide whether the article contains enough information to answer the question fully — or whether a web search is needed for definitions, background, context, or facts not in the article.

Output ONLY valid JSON with this exact schema:
{
  "need_web": boolean,
  "reason": string,
  "suggested_queries": string[],
  "must_cite": boolean
}

Rules:
- need_web = true if:
  • The user asks "what is X", "who is X", "explain X", definitions, background, agendas, history, "why does X matter", or any context question the article does not explicitly answer.
  • The article does not contain sufficient facts/figures to answer without speculation.
  • The user references an entity, organisation, concept, or policy not explained in the article.
- need_web = false if:
  • The article contains all facts needed to answer the question.
  • The question is about the article's narrative, summary, or opinion.
- suggested_queries: 1–2 concise Google-style search queries to find the missing context. Make them specific and factual.
- must_cite: true if the answer will include external facts that must be cited.
- reason: one-sentence explanation of why web search is or isn't needed.

Do NOT output anything except the JSON object.`;

interface RouterResult {
  need_web: boolean;
  reason: string;
  suggested_queries: string[];
}

async function runRouter(articleText: string, question: string): Promise<RouterResult> {
  const ck = cacheKey('router', articleText, question);
  const cached = cacheGet('router', ck);
  if (cached) {
    try { return JSON.parse(cached) as RouterResult; } catch {}
  }

  const condensed =
    articleText.length > 3_000
      ? articleText.slice(0, 3_000) + '\n…[article truncated for routing]'
      : articleText;

  const prompt = `Article (condensed):\n${condensed}\n\nUser question: ${question}`;

  const raw = await withRetry(
    () =>
      callAnthropic({
        model: MODEL_ROUTER,
        system: ROUTER_PROMPT + '\n\nYou MUST respond with ONLY valid JSON. No markdown, no prose, no code fences.',
        messages: [{ role: 'user', content: prompt }],
        maxTokens: 200,
      }),
    { label: 'router', ...RETRY_OPTS }
  );

  const parseResult = safeParseJson(raw);
  if (!parseResult.ok || !parseResult.data) {
    return { need_web: false, reason: 'Router parse failed', suggested_queries: [] };
  }

  const parsed = parseResult.data;
  const result: RouterResult = {
    need_web: typeof parsed.need_web === 'boolean' ? parsed.need_web : false,
    reason: typeof parsed.reason === 'string' ? parsed.reason : '',
    suggested_queries: Array.isArray(parsed.suggested_queries) ? parsed.suggested_queries as string[] : [],
  };

  cacheSet('router', ck, JSON.stringify(result));
  return result;
}

/* --- Tavily search --- */

const DOMAIN_SCORES: Record<string, number> = {
  'gov.uk': 3, 'parliament.uk': 3, 'congress.gov': 3, 'whitehouse.gov': 3,
  'europa.eu': 3, 'un.org': 3, 'imf.org': 3, 'worldbank.org': 3,
  'oecd.org': 3, 'wto.org': 3, 'who.int': 3,
  'federalreserve.gov': 3, 'ecb.europa.eu': 3, 'bankofengland.co.uk': 3,
  'rbi.org.in': 3, 'india.gov.in': 3, 'pib.gov.in': 3,
  'bbc.co.uk': 2, 'bbc.com': 2, 'reuters.com': 2, 'apnews.com': 2,
  'ft.com': 2, 'wsj.com': 2, 'economist.com': 2, 'theguardian.com': 2,
  'nytimes.com': 2, 'washingtonpost.com': 2, 'bloomberg.com': 2,
  'aljazeera.com': 2, 'politico.com': 2, 'politico.eu': 2,
  'cnbc.com': 2, 'thehindu.com': 2, 'indianexpress.com': 2,
  'ndtv.com': 2, 'livemint.com': 2,
  'en.wikipedia.org': 1, 'wikipedia.org': 1, 'britannica.com': 1,
};

function scoreDomain(url: string): number {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, '');
    if (DOMAIN_SCORES[hostname] !== undefined) return DOMAIN_SCORES[hostname];
    for (const [domain, score] of Object.entries(DOMAIN_SCORES)) {
      if (hostname.endsWith('.' + domain)) return score;
    }
    return 0;
  } catch { return 0; }
}

function extractDomain(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ''); }
  catch { return url; }
}

async function runSearch(queries: string[]): Promise<{ results: SearchResult[]; error: string | null }> {
  if (!TAVILY_API_KEY) return { results: [], error: 'TAVILY_API_KEY not set' };

  const toRun = queries.slice(0, 2);

  const ck = cacheKey('tavily', ...toRun);
  const cached = cacheGet('tavily', ck);
  if (cached) {
    try { return JSON.parse(cached) as { results: SearchResult[]; error: string | null }; } catch {}
  }

  // Tavily calls use withRetry but NOT the LLM rate limiter
  const searchResult = await withRetry(
    async () => {
      const searchPromises = toRun.map((q) =>
        fetch('https://api.tavily.com/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            api_key: TAVILY_API_KEY,
            query: q,
            max_results: 5,
            search_depth: 'advanced',
            exclude_domains: ['linkedin.com', 'quora.com', 'facebook.com', 'reddit.com', 'medium.com']
          }),
        }).then(async (r) => {
          if (!r.ok) {
            const body = await r.text().catch(() => '');
            throw new Error(`Tavily ${r.status}: ${body.slice(0, 200)}`);
          }
          return r.json();
        })
      );

      const timeout = new Promise<'TIMEOUT'>((resolve) =>
        setTimeout(() => resolve('TIMEOUT'), 8_000)
      );
      const raceResult = await Promise.race([Promise.all(searchPromises), timeout]);

      if (raceResult === 'TIMEOUT') {
        return { results: [] as SearchResult[], error: 'Search timed out' };
      }

      const allResults: SearchResult[] = [];
      const seenUrls = new Set<string>();

      for (const data of raceResult) {
        for (const r of data.results ?? []) {
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

      allResults.sort((a, b) => b.score - a.score);
      return { results: allResults.slice(0, 3), error: null };
    },
    { label: 'tavily-search', ...RETRY_OPTS }
  );

  cacheSet('tavily', ck, JSON.stringify(searchResult));
  return searchResult;
}

function formatSearchResults(results: SearchResult[]): string {
  if (results.length === 0) return '';
  const lines = results.map(
    (r, i) => `[${i + 1}] "${r.title}" — ${r.source}\n    URL: ${r.url}\n    ${r.snippet}`
  );
  return (
    '=== WEB SEARCH RESULTS (use for "Additional context" section; cite URL when referencing) ===\n\n' +
    lines.join('\n\n')
  );
}

/* --- Answer generation --- */

const SYSTEM_PROMPT = `You are a helpful tutor that helps users understand news articles.

## Formatting Rules (ALWAYS follow)

You MUST format every response clearly using Markdown:
- Start with a direct 1–2 sentence answer.
- Then use **bullet points** for explanations and details.
- Use short paragraphs (max 3 lines each).
- Use **bold** for key terms and section headers.
- Use section headers (##, ###) ONLY when the answer has distinct parts (e.g. article info vs. web context).
- Never output a single long wall of text.
- Keep answers concise unless the user asks for depth.
- Always finish your response with a complete sentence — never stop mid-word or mid-thought.

## Response Structure

**When web search results ARE provided:**
Structure your response with clear sections:

**From the article:**
(Information drawn directly from the article text. Reference specific parts.)

**Additional context:**
(Information from the web search results. Cite each fact with its source as a markdown link: [Source Name](URL).)

**When NO web search results are provided:**
Answer from the article. If the article is insufficient:
- You may add brief, commonly-known factual background.
- Label it: **General background (no web lookup performed):**
- Keep it minimal and factual.

## Core Rules
1. Ground answers in the article text first — always start there.
2. Never fabricate quotes, numbers, statistics, claims, sources, or URLs.
3. When citing web sources, ONLY use information from the provided search results.
4. Be concise by default. Expand only when the user asks for depth.
5. If you cannot answer even with provided sources, say so honestly.

## Source Quality (when citing web results)
- Prefer official/primary sources (government sites, regulators, committees).
- For politics/economics, prefer: gov.uk, parliament.uk, Reuters, AP, BBC, FT, WSJ, Economist.
- If sources conflict, state both viewpoints and cite each.
- Wikipedia is acceptable only for basic definitions.`;

async function generateAnswer(
  articleText: string,
  question: string,
  searchContext: string
): Promise<string> {
  const ck = cacheKey('answer', articleText, question, searchContext);
  const cached = cacheGet('answer', ck);
  if (cached) {
    try { return JSON.parse(cached) as string; } catch {}
  }

  const truncated =
    articleText.length > 10_000
      ? articleText.slice(0, 10_000) + '\n\n[Article truncated for length]'
      : articleText;

  let system = `${SYSTEM_PROMPT}\n\n=== ARTICLE TEXT ===\n\n${truncated}`;
  if (searchContext) system += `\n\n${searchContext}`;

  const answerText = await withRetry(
    () =>
      callAnthropic({
        model: MODEL_TUTOR,
        system,
        messages: [{ role: 'user', content: question }],
        maxTokens: 900,
      }),
    { label: 'answer', ...RETRY_OPTS }
  );

  cacheSet('answer', ck, JSON.stringify(answerText));
  return answerText;
}

/* ================================================================== */
/*  LLM Judges — with robust parsing + retry                        */
/* ================================================================== */

interface JudgeDiagnostics {
  rawOutputs: string[];
  allParsed: boolean;
  errors: string[];
}

/**
 * Run a judge LLM call.
 * If JSON parsing fails, retry once with a stricter prompt.
 */
async function runJudgeWithRetry<T extends Record<string, unknown>>(
  promptFn: (strict: boolean) => string,
  defaults: T,
  label: string
): Promise<{ data: T; raw: string; parseOk: boolean; parseError: string }> {
  // Attempt 1: normal prompt
  let raw = '';
  try {
    raw = await withRetry(
      () =>
        callAnthropic({
          model: MODEL_JUDGE,
          system: 'You MUST respond with ONLY valid JSON. No other text.',
          messages: [{ role: 'user', content: promptFn(false) }],
          maxTokens: 400,
        }),
      { label, ...RETRY_OPTS }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { data: defaults, raw: `ERROR: ${msg}`, parseOk: false, parseError: `Call failed: ${msg}` };
  }

  const firstParse = safeParseJson(raw);
  if (firstParse.ok && firstParse.data) {
    return { data: { ...defaults, ...firstParse.data } as T, raw, parseOk: true, parseError: '' };
  }

  // Attempt 2: stricter prompt
  console.warn(`  [${label}] Parse failed, retrying with strict prompt…`);

  let retryRaw = '';
  try {
    retryRaw = await withRetry(
      () =>
        callAnthropic({
          model: MODEL_JUDGE,
          system: 'CRITICAL: Return ONLY valid minified JSON. No markdown. No prose. No code fences. Just a single JSON object.',
          messages: [{ role: 'user', content: promptFn(true) }],
          maxTokens: 400,
        }),
      { label: `${label}-strict`, ...RETRY_OPTS }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      data: defaults,
      raw: raw + '\n---RETRY---\n' + `ERROR: ${msg}`,
      parseOk: false,
      parseError: `Retry call failed: ${msg}`,
    };
  }

  const retryParse = safeParseJson(retryRaw);
  const combinedRaw = raw + '\n---RETRY---\n' + retryRaw;

  if (retryParse.ok && retryParse.data) {
    return { data: { ...defaults, ...retryParse.data } as T, raw: combinedRaw, parseOk: true, parseError: '' };
  }

  return {
    data: defaults,
    raw: combinedRaw,
    parseOk: false,
    parseError: `Both attempts failed. First: ${firstParse.error ?? 'unknown'}. Retry: ${retryParse.error ?? 'unknown'}`,
  };
}

/* --- Judge 1: Should-search correctness --- */

function shouldSearchPrompt(
  articleText: string,
  question: string,
  routerNeedWeb: boolean | null,
  expectedShouldSearch: string,
  strict: boolean
): string {
  const condensed =
    articleText.length > 2_000
      ? articleText.slice(0, 2_000) + '\n…[truncated]'
      : articleText;

  const prefix = strict
    ? 'Return ONLY valid minified JSON. No markdown. No prose. No code fences.\n\n'
    : '';

  return `${prefix}You are evaluating a news tutoring AI's router decision.

Article (condensed):
${condensed}

User question: ${question}

The router decided: need_web = ${routerNeedWeb}
The expected label was: need_web = ${expectedShouldSearch}

Evaluate whether the router's decision was CORRECT. Consider:
- Does the article contain enough information to fully answer the question?
- Would a web search be necessary for definitions, background, or context not in the article?

Output strict JSON:
{"correct": true or false, "reasoning": "brief explanation (1-2 sentences)"}`;
}

/* --- Judge 2: Completeness score --- */

function completenessPrompt(question: string, answerText: string, strict: boolean): string {
  const prefix = strict
    ? 'Return ONLY valid minified JSON. No markdown. No prose. No code fences.\n\n'
    : '';

  return `${prefix}You are evaluating the completeness of an AI tutor's answer to a reader's question about a news article.

User question: ${question}

AI Answer:
${answerText.slice(0, 2_000)}

Rate the completeness on a 1-5 scale:
1 = Completely misses the point, doesn't address the question
2 = Partially addresses the question but missing key information
3 = Addresses the question adequately but could be more thorough
4 = Good, thorough answer with relevant details
5 = Excellent, comprehensive answer that fully addresses the question

Output strict JSON:
{"score": 1-5, "reasoning": "brief explanation (1-2 sentences)"}`;
}

/* --- Judge 3: Unsupported claims --- */

function unsupportedPrompt(
  articleText: string,
  sourceSummary: string,
  answerText: string,
  strict: boolean
): string {
  const condensedArticle =
    articleText.length > 2_000
      ? articleText.slice(0, 2_000) + '\n…[truncated]'
      : articleText;

  const prefix = strict
    ? 'Return ONLY valid minified JSON. No markdown. No prose. No code fences.\n\n'
    : '';

  return `${prefix}You are checking if an AI answer contains unsupported claims.

Article text:
${condensedArticle}

${sourceSummary ? `Web sources used:\n${sourceSummary}\n` : '(No web sources were used)'}

AI Answer:
${answerText.slice(0, 2_000)}

Check if the answer contains any specific factual claims (names, numbers, dates, statistics, quotes) that are NOT supported by either:
1. The article text above
2. The web sources listed above (if provided)
3. Common general knowledge (widely known facts)

Ignore formatting, style, or vague statements. Focus on concrete factual claims.

Output strict JSON:
{"unsupported_claims": true or false, "explanation": "brief explanation of any unsupported claims found, or 'All claims are supported'"}`;
}

/* ================================================================== */
/*  Main eval loop                                                    */
/* ================================================================== */

async function main() {
  if (!ANTHROPIC_API_KEY) {
    console.error('ANTHROPIC_API_KEY not set. Add it to .env.local.');
    process.exit(1);
  }

  // Read dataset
  if (!fs.existsSync(DATASET_PATH)) {
    console.error(`Dataset not found at ${DATASET_PATH}\nRun: npm run eval:generate`);
    process.exit(1);
  }

  const rawLines = fs.readFileSync(DATASET_PATH, 'utf-8').trim().split('\n');
  const cases: DatasetCase[] = [];
  for (let i = 0; i < rawLines.length; i++) {
    if (!rawLines[i].trim()) continue;
    try {
      cases.push(JSON.parse(rawLines[i]));
    } catch (err) {
      console.warn(`[dataset] Skipping malformed line ${i + 1}: ${String(err)}`);
    }
  }

  if (cases.length === 0) {
    console.error('No valid cases in dataset.');
    process.exit(1);
  }

  // Resume from partial results
  const completedIds = new Set<string>();
  let results: EvalResult[] = [];

  if (EVAL_RESUME && fs.existsSync(PARTIAL_PATH)) {
    try {
      const partial = JSON.parse(fs.readFileSync(PARTIAL_PATH, 'utf-8'));
      if (Array.isArray(partial)) {
        results = partial as EvalResult[];
        for (const r of results) completedIds.add(r.case_id);
        console.log(`[resume] Found ${results.length} completed cases from partial results.`);
      }
    } catch {
      console.warn('[resume] Could not parse partial results, starting fresh.');
    }
  }

  const remaining = cases.filter((c) => !completedIds.has(c.case_id));

  console.log(`=== Running eval on ${cases.length} total cases (${remaining.length} remaining) ===`);
  console.log(`    Provider: Anthropic (Claude)`);
  console.log(`    Models: router=${MODEL_ROUTER}, tutor=${MODEL_TUTOR}, judge=${MODEL_JUDGE}`);
  console.log(`    Rate limit: ${getMinDelayMs()}ms min between LLM calls`);
  console.log(`    Throttle: ${EVAL_THROTTLE_MS}ms between cases`);
  console.log(`    Cache: ${EVAL_CACHE ? 'ON' : 'OFF'}`);
  console.log(`    Tavily: ${TAVILY_API_KEY ? 'available' : 'NOT SET'}`);
  console.log(`    Estimated time: ~${Math.ceil(remaining.length * 5 * getMinDelayMs() / 60000)} minutes\n`);

  for (let i = 0; i < cases.length; i++) {
    const c = cases[i];
    if (completedIds.has(c.case_id)) continue;

    const totalStart = Date.now();
    const articleText = getArticleText(c);
    const caseNum = results.length + 1;
    console.log(`[${caseNum}/${cases.length}] ${c.case_id}: "${c.question.slice(0, 60)}…"`);

    if (!articleText || articleText.length < 20) {
      console.warn(`  ⚠ Article text too short (${articleText.length} chars), skipping.`);
      results.push(makeFailedResult(c, 'Article text too short or missing', Date.now() - totalStart));
      writePartial(results);
      continue;
    }

    // --- Pipeline accumulators ---
    let routerNeedWeb: boolean | null = null;
    let routerReason = '';
    let suggestedQueries: string[] = [];
    let searchCalled = false;
    let sourcesUsed: string[] = [];
    let searchResultsList: SearchResult[] = [];
    let searchError: string | null = null;
    let answerText = '';
    let pipelineError: string | null = null;

    try {
      // Step 1: Router
      const routing = await runRouter(articleText, c.question);
      routerNeedWeb = routing.need_web;
      routerReason = routing.reason;
      suggestedQueries = routing.suggested_queries;
      console.log(`  router: need_web=${routing.need_web}, queries=${routing.suggested_queries.length}`);

      // Step 2: Search (if needed) — no LLM rate limit, just inter-step throttle
      let searchContext = '';
      if (routing.need_web && routing.suggested_queries.length > 0) {
        searchCalled = true;
        const enhancedQueries = buildEnhancedQueries(
          routing.suggested_queries,
          c.article_title,
          c.question
        );
        console.log(`  enhanced queries: ${enhancedQueries.map((q) => q.slice(0, 80)).join(' | ')}`);
        const searchResult = await runSearch(enhancedQueries);
        searchResultsList = searchResult.results;
        searchError = searchResult.error;
        sourcesUsed = searchResult.results.map((r) => r.source);
        if (searchResult.results.length > 0) {
          searchContext = formatSearchResults(searchResult.results);
        }
        console.log(`  search: ${searchResult.results.length} sources, error=${searchResult.error}`);
      }

      // Step 3: Answer
      answerText = await generateAnswer(articleText, c.question, searchContext);
      console.log(`  answer: ${answerText.length} chars`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      pipelineError = msg;
      console.warn(`  ⚠ Pipeline error: ${msg.slice(0, 120)}`);
      answerText = answerText || `ERROR: ${msg}`;
    }

    // Deterministic metrics
    const citationsPresent = hasCitations(answerText);
    const citationAnalysis = analyzeCitations(answerText);
    const badDomainsFound = sourcesUsed.filter((d) =>
      BAD_DOMAINS.some((bd) => d.includes(bd))
    );
    const searchCompliance = routerNeedWeb === true && searchCalled;
    const citationCoverage = searchCalled && citationsPresent;
    const badDomainsPresent = badDomainsFound.length > 0;

    // Retrieval alignment (Jaccard)
    let alignmentScore: number | null = null;
    let lowAlignment = false;
    if (searchCalled && searchResultsList.length > 0) {
      const qTokens = tokenize(c.question);
      const jaccardScores = searchResultsList.map((r) =>
        jaccardSimilarity(qTokens, tokenize(r.snippet))
      );
      alignmentScore =
        jaccardScores.reduce((s, v) => s + v, 0) / jaccardScores.length;
      lowAlignment = alignmentScore < 0.10;
    }

    // Low-cred domain ratio
    const lowCredCount = searchResultsList.filter((r) =>
      LOW_CRED_DOMAINS.some((d) => r.source.includes(d))
    ).length;
    const totalResultsCount = searchResultsList.length;
    const lowCredRatio = totalResultsCount > 0 ? lowCredCount / totalResultsCount : 0;
    const lowCredDominant = lowCredRatio > 0.5;

    // --- LLM Judges ---
    let shouldSearchCorrect: boolean | null = null;
    let shouldSearchReasoning = 'Skipped';
    let completenessScore: number | null = null;
    let completenessReasoning = 'Skipped';
    let unsupportedClaims: boolean | null = null;
    let unsupportedExplanation = 'Skipped';

    const diag: JudgeDiagnostics = { rawOutputs: [], allParsed: true, errors: [] };

    if (answerText && !answerText.startsWith('ERROR:')) {
      // Judge 1: Should-search
      try {
        const j1 = await runJudgeWithRetry(
          (strict) => shouldSearchPrompt(articleText, c.question, routerNeedWeb, c.expected_should_search, strict),
          { correct: false, reasoning: 'Judge failed' } as Record<string, unknown>,
          'judge-search'
        );
        diag.rawOutputs.push(j1.raw);
        if (j1.parseOk) {
          shouldSearchCorrect = typeof j1.data.correct === 'boolean' ? j1.data.correct : null;
          shouldSearchReasoning = typeof j1.data.reasoning === 'string' ? j1.data.reasoning : 'No reasoning';
        } else {
          diag.allParsed = false;
          diag.errors.push(`judge-search: ${j1.parseError}`);
          console.warn(`  ⚠ judge-search parse failed: ${j1.parseError.slice(0, 80)}`);
        }
      } catch (err) {
        diag.allParsed = false;
        const msg = err instanceof Error ? err.message : String(err);
        diag.errors.push(`judge-search: ${msg}`);
        console.warn(`  ⚠ judge-search error: ${msg.slice(0, 80)}`);
      }

      // Judge 2: Completeness
      try {
        const j2 = await runJudgeWithRetry(
          (strict) => completenessPrompt(c.question, answerText, strict),
          { score: 0, reasoning: 'Judge failed' } as Record<string, unknown>,
          'judge-completeness'
        );
        diag.rawOutputs.push(j2.raw);
        if (j2.parseOk) {
          const rawScore = typeof j2.data.score === 'number' ? j2.data.score : 0;
          completenessScore = rawScore > 0 ? Math.max(1, Math.min(5, Math.round(rawScore))) : null;
          completenessReasoning = typeof j2.data.reasoning === 'string' ? j2.data.reasoning : 'No reasoning';
        } else {
          diag.allParsed = false;
          diag.errors.push(`judge-completeness: ${j2.parseError}`);
          console.warn(`  ⚠ judge-completeness parse failed: ${j2.parseError.slice(0, 80)}`);
        }
      } catch (err) {
        diag.allParsed = false;
        const msg = err instanceof Error ? err.message : String(err);
        diag.errors.push(`judge-completeness: ${msg}`);
        console.warn(`  ⚠ judge-completeness error: ${msg.slice(0, 80)}`);
      }

      // Judge 3: Unsupported claims
      try {
        const sourceSummary = searchResultsList
          .map((r) => `- ${r.title} | ${r.url} | ${r.source}`)
          .join('\n');
        const j3 = await runJudgeWithRetry(
          (strict) => unsupportedPrompt(articleText, sourceSummary, answerText, strict),
          { unsupported_claims: false, explanation: 'Judge failed' } as Record<string, unknown>,
          'judge-unsupported'
        );
        diag.rawOutputs.push(j3.raw);
        if (j3.parseOk) {
          unsupportedClaims = typeof j3.data.unsupported_claims === 'boolean' ? j3.data.unsupported_claims : null;
          unsupportedExplanation = typeof j3.data.explanation === 'string' ? j3.data.explanation : 'No explanation';
        } else {
          diag.allParsed = false;
          diag.errors.push(`judge-unsupported: ${j3.parseError}`);
          console.warn(`  ⚠ judge-unsupported parse failed: ${j3.parseError.slice(0, 80)}`);
        }
      } catch (err) {
        diag.allParsed = false;
        const msg = err instanceof Error ? err.message : String(err);
        diag.errors.push(`judge-unsupported: ${msg}`);
        console.warn(`  ⚠ judge-unsupported error: ${msg.slice(0, 80)}`);
      }
    } else {
      diag.allParsed = false;
      diag.errors.push('Judges skipped: pipeline error or empty answer');
    }

    const latencyTotal = Date.now() - totalStart;

    results.push({
      case_id: c.case_id,
      article_id: c.article_id,
      article_title: c.article_title,
      question: c.question,
      expected_should_search: c.expected_should_search,
      router_need_web: routerNeedWeb,
      router_reason: routerReason,
      search_called: searchCalled,
      sources_used: sourcesUsed,
      citations_present: citationsPresent,
      latency_total_ms: latencyTotal,
      answer_text: answerText,
      search_compliance: searchCompliance,
      citation_coverage: citationCoverage,
      bad_domains_present: badDomainsPresent,
      bad_domains: badDomainsFound,
      ...citationAnalysis,
      alignment_score: alignmentScore,
      low_alignment: lowAlignment,
      low_cred_count: lowCredCount,
      total_results: totalResultsCount,
      low_cred_ratio: lowCredRatio,
      low_cred_dominant: lowCredDominant,
      should_search_correct: shouldSearchCorrect,
      should_search_reasoning: shouldSearchReasoning,
      completeness_score: completenessScore,
      completeness_reasoning: completenessReasoning,
      unsupported_claims: unsupportedClaims,
      unsupported_explanation: unsupportedExplanation,
      judge_raw_output: diag.rawOutputs.join('\n===\n').slice(0, 2000),
      judge_parse_ok: diag.allParsed,
      judge_parse_error: diag.errors.join('; '),
      pipeline_error: pipelineError,
    });

    writePartial(results);
    console.log(`  ✓ done (${(latencyTotal / 1000).toFixed(1)}s)\n`);

    // Inter-case throttle (on top of per-call rate limiter)
    if (i < cases.length - 1 && !completedIds.has(cases[i + 1]?.case_id)) {
      await delay(EVAL_THROTTLE_MS);
    }
  }

  // Write final results
  fs.writeFileSync(RESULTS_PATH, JSON.stringify(results, null, 2));
  console.log(`\n✅ Results written to ${RESULTS_PATH}`);

  // Clean up partial file
  try { if (fs.existsSync(PARTIAL_PATH)) fs.unlinkSync(PARTIAL_PATH); } catch {}

  // Compute & write summary
  const summary = computeSummary(results);
  console.log('\n' + summary);
  fs.writeFileSync(SUMMARY_PATH, summary);
  console.log(`✅ Summary written to ${SUMMARY_PATH}`);
}

/* ================================================================== */
/*  Helpers                                                           */
/* ================================================================== */

function makeFailedResult(c: DatasetCase, error: string, latency: number): EvalResult {
  return {
    case_id: c.case_id,
    article_id: c.article_id,
    article_title: c.article_title,
    question: c.question,
    expected_should_search: c.expected_should_search,
    router_need_web: null,
    router_reason: '',
    search_called: false,
    sources_used: [],
    citations_present: false,
    latency_total_ms: latency,
    answer_text: `ERROR: ${error}`,
    search_compliance: false,
    citation_coverage: false,
    bad_domains_present: false,
    bad_domains: [],
    has_markdown_link: false,
    has_url_anywhere: false,
    has_inline_source_tags: false,
    has_sources_section_near_end: false,
    sources_section_has_url: false,
    end_sources_with_url: false,
    alignment_score: null,
    low_alignment: false,
    low_cred_count: 0,
    total_results: 0,
    low_cred_ratio: 0,
    low_cred_dominant: false,
    should_search_correct: null,
    should_search_reasoning: 'Skipped',
    completeness_score: null,
    completeness_reasoning: 'Skipped',
    unsupported_claims: null,
    unsupported_explanation: 'Skipped',
    judge_raw_output: '',
    judge_parse_ok: false,
    judge_parse_error: `Pipeline failed: ${error}`,
    pipeline_error: error,
  };
}

function writePartial(results: EvalResult[]): void {
  try { fs.writeFileSync(PARTIAL_PATH, JSON.stringify(results, null, 2)); } catch {}
}

/* ================================================================== */
/*  Summary computation                                               */
/* ================================================================== */

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

function computeSummary(results: EvalResult[]): string {
  const total = results.length;
  if (total === 0) return '# Eval Summary\n\nNo results.';

  const successful = results.filter((r) => !r.pipeline_error);
  const failed = results.filter((r) => !!r.pipeline_error);

  // Router accuracy
  const judgedSearchCases = results.filter((r) => r.should_search_correct !== null);
  const searchCorrectCount = judgedSearchCases.filter((r) => r.should_search_correct === true).length;
  const searchAccuracy =
    judgedSearchCases.length > 0
      ? ((searchCorrectCount / judgedSearchCases.length) * 100).toFixed(1)
      : 'N/A';

  // Search compliance
  const routerYesCases = results.filter((r) => r.router_need_web === true);
  const searchComplianceCount = routerYesCases.filter((r) => r.search_compliance).length;
  const searchComplianceRate =
    routerYesCases.length > 0
      ? ((searchComplianceCount / routerYesCases.length) * 100).toFixed(1)
      : 'N/A';

  // Citation coverage
  const searchCalledCases = results.filter((r) => r.search_called);
  const citationCovCount = searchCalledCases.filter((r) => r.citation_coverage).length;
  const citationCoverageRate =
    searchCalledCases.length > 0
      ? ((citationCovCount / searchCalledCases.length) * 100).toFixed(1)
      : 'N/A';

  // Bad domain rate
  const badDomainCount = searchCalledCases.filter((r) => r.bad_domains_present).length;
  const badDomainRate =
    searchCalledCases.length > 0
      ? ((badDomainCount / searchCalledCases.length) * 100).toFixed(1)
      : 'N/A';

  // Citation analysis (over search_called cases)
  const endSourcesWithUrlCount = searchCalledCases.filter((r) => r.end_sources_with_url).length;
  const endSourcesWithUrlRate =
    searchCalledCases.length > 0
      ? ((endSourcesWithUrlCount / searchCalledCases.length) * 100).toFixed(1)
      : 'N/A';
  const sourcesSectionCount = searchCalledCases.filter((r) => r.has_sources_section_near_end).length;
  const sourcesSectionRate =
    searchCalledCases.length > 0
      ? ((sourcesSectionCount / searchCalledCases.length) * 100).toFixed(1)
      : 'N/A';
  const urlCovCount = searchCalledCases.filter((r) => r.has_url_anywhere).length;
  const urlCovRate =
    searchCalledCases.length > 0
      ? ((urlCovCount / searchCalledCases.length) * 100).toFixed(1)
      : 'N/A';
  const mdLinkCount = searchCalledCases.filter((r) => r.has_markdown_link).length;
  const mdLinkRate =
    searchCalledCases.length > 0
      ? ((mdLinkCount / searchCalledCases.length) * 100).toFixed(1)
      : 'N/A';
  const inlineTagCount = searchCalledCases.filter((r) => r.has_inline_source_tags).length;
  const inlineTagRate =
    searchCalledCases.length > 0
      ? ((inlineTagCount / searchCalledCases.length) * 100).toFixed(1)
      : 'N/A';

  // Retrieval alignment (Jaccard)
  const alignmentCases = searchCalledCases.filter((r) => r.alignment_score !== null);
  const avgAlignment =
    alignmentCases.length > 0
      ? (alignmentCases.reduce((s, r) => s + (r.alignment_score ?? 0), 0) / alignmentCases.length).toFixed(3)
      : 'N/A';
  const lowAlignmentCount = alignmentCases.filter((r) => r.low_alignment).length;
  const lowAlignmentRate =
    alignmentCases.length > 0
      ? ((lowAlignmentCount / alignmentCases.length) * 100).toFixed(1)
      : 'N/A';

  // Low-cred domain ratio
  const avgLowCredRatio =
    searchCalledCases.length > 0
      ? ((searchCalledCases.reduce((s, r) => s + r.low_cred_ratio, 0) / searchCalledCases.length) * 100).toFixed(1)
      : 'N/A';
  const lowCredDominantCount = searchCalledCases.filter((r) => r.low_cred_dominant).length;
  const lowCredDominanceRate =
    searchCalledCases.length > 0
      ? ((lowCredDominantCount / searchCalledCases.length) * 100).toFixed(1)
      : 'N/A';

  // Completeness
  const validScores = results.filter((r) => r.completeness_score !== null && r.completeness_score > 0);
  const avgCompleteness =
    validScores.length > 0
      ? (validScores.reduce((s, r) => s + (r.completeness_score ?? 0), 0) / validScores.length).toFixed(2)
      : 'N/A';

  // Unsupported claims
  const judgedUnsupported = results.filter((r) => r.unsupported_claims !== null);
  const unsupportedCount = judgedUnsupported.filter((r) => r.unsupported_claims === true).length;
  const unsupportedRate =
    judgedUnsupported.length > 0
      ? ((unsupportedCount / judgedUnsupported.length) * 100).toFixed(1)
      : 'N/A';

  // Latency
  const latencies = successful.map((r) => r.latency_total_ms).sort((a, b) => a - b);
  const avgLatency = latencies.length > 0
    ? Math.round(latencies.reduce((s, v) => s + v, 0) / latencies.length)
    : 0;
  const p50 = latencies.length > 0 ? Math.round(percentile(latencies, 50)) : 0;
  const p95 = latencies.length > 0 ? Math.round(percentile(latencies, 95)) : 0;

  // Judge parse failure rate
  const parseFailures = results.filter((r) => !r.judge_parse_ok).length;
  const parseFailureRate = ((parseFailures / total) * 100).toFixed(1);

  // Breakdowns
  const routerYesRate = ((routerYesCases.length / total) * 100).toFixed(1);
  const expectedYesCount = results.filter((r) => r.expected_should_search === 'yes').length;

  const now = new Date().toISOString();

  return `# Eval Summary

**Run:** ${now}
**Cases:** ${total} (${successful.length} succeeded, ${failed.length} failed)
**Provider:** Anthropic | Models: router=${MODEL_ROUTER}, tutor=${MODEL_TUTOR}, judge=${MODEL_JUDGE}

## Metrics

| Metric | Value |
|--------|-------|
| Router Should_Search Accuracy | ${searchAccuracy}${searchAccuracy !== 'N/A' ? `% (${searchCorrectCount}/${judgedSearchCases.length})` : ''} |
| Search Compliance Rate | ${searchComplianceRate}${searchComplianceRate !== 'N/A' ? `% (${searchComplianceCount}/${routerYesCases.length})` : ''} |
| Citation Coverage Rate | ${citationCoverageRate}${citationCoverageRate !== 'N/A' ? `% (${citationCovCount}/${searchCalledCases.length})` : ''} |
| **End Sources With URL Rate** | ${endSourcesWithUrlRate}${endSourcesWithUrlRate !== 'N/A' ? `% (${endSourcesWithUrlCount}/${searchCalledCases.length})` : ''} |
| Sources Section Coverage | ${sourcesSectionRate}${sourcesSectionRate !== 'N/A' ? `% (${sourcesSectionCount}/${searchCalledCases.length})` : ''} |
| URL Coverage | ${urlCovRate}${urlCovRate !== 'N/A' ? `% (${urlCovCount}/${searchCalledCases.length})` : ''} |
| Markdown Link Coverage | ${mdLinkRate}${mdLinkRate !== 'N/A' ? `% (${mdLinkCount}/${searchCalledCases.length})` : ''} |
| Inline Source Tag Rate | ${inlineTagRate}${inlineTagRate !== 'N/A' ? `% (${inlineTagCount}/${searchCalledCases.length})` : ''} |
| Avg Retrieval Alignment | ${avgAlignment}${avgAlignment !== 'N/A' ? ` (n=${alignmentCases.length})` : ''} |
| % Low Alignment Cases | ${lowAlignmentRate}${lowAlignmentRate !== 'N/A' ? `% (${lowAlignmentCount}/${alignmentCases.length})` : ''} |
| Avg Low Cred Ratio | ${avgLowCredRatio}${avgLowCredRatio !== 'N/A' ? `% (n=${searchCalledCases.length})` : ''} |
| % Low Cred Dominance | ${lowCredDominanceRate}${lowCredDominanceRate !== 'N/A' ? `% (${lowCredDominantCount}/${searchCalledCases.length})` : ''} |
| Bad Domain Rate | ${badDomainRate}${badDomainRate !== 'N/A' ? `% (${badDomainCount}/${searchCalledCases.length})` : ''} |
| Avg Completeness Score | ${avgCompleteness}${avgCompleteness !== 'N/A' ? `/5 (n=${validScores.length})` : ''} |
| Unsupported Claim Rate | ${unsupportedRate}${unsupportedRate !== 'N/A' ? `% (${unsupportedCount}/${judgedUnsupported.length})` : ''} |
| Latency (avg / p50 / p95) | ${avgLatency}ms / ${p50}ms / ${p95}ms |
| Judge Parse Failure Rate | ${parseFailureRate}% (${parseFailures}/${total}) |

## Breakdown

| Stat | Value |
|------|-------|
| Router need_web = true | ${routerYesRate}% (${routerYesCases.length}/${total}) |
| Expected should_search = yes | ${((expectedYesCount / total) * 100).toFixed(1)}% (${expectedYesCount}/${total}) |
| Search called | ${searchCalledCases.length}/${total} |
| Tavily available | ${TAVILY_API_KEY ? 'yes' : 'no'} |
| Pipeline failures | ${failed.length}/${total} |

## Bad Domains Found

${
  results.filter((r) => r.bad_domains.length > 0).length === 0
    ? '_None_'
    : results
        .filter((r) => r.bad_domains.length > 0)
        .map((r) => `- **${r.case_id}**: ${r.bad_domains.join(', ')}`)
        .join('\n')
}

## Parse Failures

${
  parseFailures === 0
    ? '_None — all judge outputs parsed successfully_'
    : results
        .filter((r) => !r.judge_parse_ok)
        .map((r) => `- **${r.case_id}**: ${r.judge_parse_error.slice(0, 120)}`)
        .join('\n')
}

## Pipeline Failures

${
  failed.length === 0
    ? '_None — all cases completed successfully_'
    : failed
        .map((r) => `- **${r.case_id}**: ${r.pipeline_error?.slice(0, 120)}`)
        .join('\n')
}
`;
}

/* ================================================================== */
/*  Run                                                               */
/* ================================================================== */

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
