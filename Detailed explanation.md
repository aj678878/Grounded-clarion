# Clarion: Detailed Explanation

This document explains the end-to-end architecture and runtime flow of Clarion, based directly on the current codebase.

## 1) High-Level System Design

Clarion is a Next.js App Router application with four major subsystems:

1. Content ingestion and article rendering
- Gets news from the Guardian Content API.
- Shows a balanced feed on the homepage.
- Fetches and renders full article pages.

2. Conversational tutoring pipeline
- Receives user question + article text.
- Runs a router LLM step to decide if web search is required.
- Optionally runs Tavily search + enrichment.
- Runs tutor LLM response generation.
- Enforces and repairs source formatting if web context was used.

3. Observability and product metrics
- Logs product events (`thread_started`, `turn_added`, `clear_clicked`) to `metric_events`.
- Logs detailed per-chat traces (`router`, `search`, latencies, answer) to `chat_traces`.
- Exposes `/debug/traces` for inspection.

4. Shared LLM reliability layer
- Anthropic client wrapper.
- Global API rate limiter.
- Retry logic for transient failures.
- Safe JSON parsing for router/judges.

---

## 2) Architecture Map (Code Locations)

Frontend / UI:
- Feed page: `/Users/akashjain/Clarion/src/app/page.tsx`
- Article server page: `/Users/akashjain/Clarion/src/app/article/[...id]/page.tsx`
- Article client view + chat mount: `/Users/akashjain/Clarion/src/app/article/[...id]/ArticleView.tsx`
- Chat UX + request dispatch: `/Users/akashjain/Clarion/src/components/ChatPanel.tsx`
- Chat rendering: `/Users/akashjain/Clarion/src/components/ChatBubble.tsx`

API routes:
- Feed API: `/Users/akashjain/Clarion/src/app/api/feed/route.ts` (`GET`)
- Article API: `/Users/akashjain/Clarion/src/app/api/article/route.ts` (`GET`)
- Chat API: `/Users/akashjain/Clarion/src/app/api/chat/route.ts` (`POST`)
- Metric API: `/Users/akashjain/Clarion/src/app/api/metric/route.ts` (`POST`)

Core libraries:
- Guardian integration: `/Users/akashjain/Clarion/src/lib/guardian.ts`
- Search pipeline (Tavily + scoring + extraction): `/Users/akashjain/Clarion/src/lib/search.ts`
- Router/tutor prompt logic: `/Users/akashjain/Clarion/src/lib/gemini.ts`
- LLM facade/retry/json parsing: `/Users/akashjain/Clarion/src/lib/llm/index.ts`
- Anthropic transport: `/Users/akashjain/Clarion/src/lib/llm/anthropic.ts`
- LLM rate limiter: `/Users/akashjain/Clarion/src/lib/llm/limiter.ts`
- Metrics persistence: `/Users/akashjain/Clarion/src/lib/db.ts`
- Trace persistence: `/Users/akashjain/Clarion/src/lib/traces.ts`
- Types: `/Users/akashjain/Clarion/src/types/index.ts`

Debug page:
- Trace viewer: `/Users/akashjain/Clarion/src/app/debug/traces/page.tsx`

---

## 3) What Each Part Does

### 3.1 Feed and article content layer

#### Feed fetch (`/`)
- `FeedPage` in `src/app/page.tsx` calls `fetch('/api/feed?page=<n>&q=<optional>')`.
- Route `GET /api/feed` (`src/app/api/feed/route.ts`) does:
  - Parse `page` and optional `q`.
  - If `q` exists, call `searchFeed(query, page)`.
  - Else call `fetchBalancedFeed(page)`.
  - Deduplicate via `deduplicateArticles`.
  - Return `{ articles, page, hasMore }`.

#### Guardian adapter
- `fetchBalancedFeed` (`src/lib/guardian.ts`):
  - Fetches sections: `business`, `world`, `technology`, plus search query `India`.
  - Uses `fetchWithRetry` (2 retries).
  - Maps Guardian raw payload to internal `GuardianArticle`.
- `searchFeed(query, page)`:
  - Guardian search endpoint, page-size 30.
- `fetchArticle(id)`:
  - Fetch full article with `body`, `trailText`, `thumbnail`.
  - Stores in in-memory `Map` cache (`articleCache`) per server process.

### 3.2 Article rendering and chat mount

- Server component `ArticlePage` (`src/app/article/[...id]/page.tsx`):
  - Converts URL segments to article id.
  - Calls `fetchArticle(articleId)` server-side.
  - Passes article to client `ArticleView`.

- Client `ArticleView` (`src/app/article/[...id]/ArticleView.tsx`):
  - Converts `article.bodyHtml` to plain text via `htmlToText`.
  - Renders article body.
  - Mounts `ChatPanel` with:
    - `articleId`
    - `articleTitle`
    - `articleText` (plain text)

### 3.3 Chat request pipeline

- `ChatPanel.handleSend` (`src/components/ChatPanel.tsx`):
  - Gets/creates thread id.
  - Logs `thread_started` metric if new thread.
  - Builds `threadHistory` from current thread messages.
  - Sends `POST /api/chat` with body:
    - `session_id`, `article_id`, `article_title`, `articleText`, `chatHistory`, `userMessage`, `thread_id`.

- `POST /api/chat` (`src/app/api/chat/route.ts`):
  - Validates payload.
  - Sanitizes chat history.
  - Router stage: `checkSufficiency(...)`.
  - Search stage (conditional):
    - `enhanceSearchQuery(...)`
    - `searchTavily(...)`
    - `formatSearchResultsForLLM(...)`
  - Answer stage: `generateChatResponse(...)`.
  - Sources enforcement/repair (if search used):
    - Validate with `hasValidSourcesSection`.
    - Try `repairSourcesInAnswer`.
    - If still invalid, append deterministic fallback sources section.
  - Optionally append timeout note if Tavily timed out.
  - Fire-and-forget trace insert via `insertChatTrace(...)`.
  - Return `{ assistantMessage }`.

### 3.4 Search subsystem details

`src/lib/search.ts` does:

1. Candidate retrieval
- Calls Tavily endpoint for up to 2 queries, `max_results=10`, `search_depth='advanced'`.
- 8s global search timeout (`SEARCH_TIMEOUT_MS`).

2. Safety and sanitation
- `asString(x)` and `hasUrl(u)` protect against undefined fields.
- Skips results without valid `http...` URL.
- Uses local blocklist (`facebook`, `quora`, `reddit`, etc.).

3. Scoring + dedupe
- `canonicalizeUrl` strips tracking params.
- `scoreDomain` gives credibility score from `DOMAIN_SCORES`.
- `blendRelevance(question, resultText)` computes relevance from:
  - token recall
  - Jaccard overlap
  - bigram phrase overlap
- Blended ranking score:
  - `0.65 * normalizedDomainCred + 0.35 * relevanceScore`
- Dedupes by canonical URL, selects top `TOP_N=5`.

4. Content enrichment
- `fetchAndExtractReadableText(url)`:
  - Dynamic-imports `jsdom` + `@mozilla/readability` lazily.
  - If unavailable, falls back to snippet mode.
  - Fetches page with browser headers and 4s timeout.
  - Rejects non-HTML, very short content, paywall-like pages.
- `enrichWithFullText`:
  - Parallel extraction (`Promise.allSettled`).
  - Per-source cap `2500` chars.
  - Total context cap `12000` chars.
  - Fallback to Tavily snippet on failures.

5. LLM formatting
- `formatSearchResultsForLLM(results)` returns:
  - Header `=== WEB CONTEXT ... ===`
  - Blocks with Title, URL, and `CONTENT`.
  - Uses fallback `(No extractable text available)` if empty.

### 3.5 LLM subsystem details

#### Provider facade (`src/lib/llm/index.ts`)
- `generateText(...)`:
  - Normalizes history to valid Anthropic message sequence.
  - Appends current user prompt.
  - Calls `callAnthropic(...)` via `withRetry`.
- `generateJSON(...)`:
  - Adds strict JSON-only instruction.
  - Parses with `safeParseJson(...)`.
  - On parse failure, retries once with stricter JSON instruction.
- `withRetry(...)`:
  - Exponential backoff defaults: 2s -> 4s -> 8s, max 3 attempts.
  - Retries only transient error patterns.

#### Anthropic transport (`src/lib/llm/anthropic.ts`)
- `callAnthropic(...)`:
  - Reads `ANTHROPIC_API_KEY` lazily.
  - Applies global rate limiter (`rateLimit()`).
  - Calls Messages API `/v1/messages`.
  - Returns concatenated text blocks.

#### Global limiter (`src/lib/llm/limiter.ts`)
- Enforces min gap between all LLM calls.
- `LLM_MIN_DELAY_MS` default is `13000` ms.

### 3.6 Product metrics and traces

Metrics events:
- `POST /api/metric` validates and inserts into `metric_events` via `insertMetricEvent`.
- If `DATABASE_URL` missing, DB layer no-ops with warning.

Chat traces:
- `/api/chat` assembles `ChatTrace` object with:
  - router decision and reason
  - search called/queries/sources/errors
  - answer text, citation presence, char count
  - latency breakdown
- Inserted by `insertChatTrace` into `chat_traces` (fire-and-forget).
- `/debug/traces` reads recent rows via `getRecentTraces(50)`.

---

## 4) End-to-End Flow When User Asks a Question

This is the exact runtime sequence and data movement.

### Step 0: Input capture on client
File: `src/components/ChatPanel.tsx`

1. User types text and presses Enter.
2. `handleSend()` runs with local state:
- `input`
- `threadId`
- `messages`
- `sessionId` (from `getSessionId()`)

3. If no thread active:
- `tid = generateThreadId()`
- `setThreadId(tid)`
- `logMetric({ event_type: 'thread_started', ... })`

4. Builds `threadHistory` from current thread messages:
- Takes `next` messages array.
- Filters by same `threadId`.
- Excludes newest user message (`slice(0, -1)`).
- Maps to `{ role, content }`.

5. Sends API request:
- Endpoint: `POST /api/chat`
- JSON body (ChatRequest):
  - `session_id: string`
  - `article_id: string`
  - `article_title: string`
  - `articleText: string`
  - `chatHistory: ChatMessage[]`
  - `userMessage: string`
  - `thread_id: string`

6. Success path:
- Receives `{ assistantMessage }`.
- Pushes assistant message to UI state.
- Logs `turn_added` metric.

7. Error path:
- Maps known backend errors (`LLM_TIMEOUT`, `QUOTA_EXCEEDED`, `TOKEN_OVERFLOW`) to friendly text.

### Step 1: Chat route validation and setup
File: `src/app/api/chat/route.ts`, function `POST(request)`

Inputs:
- `request.json()` parsed as `Partial<ChatRequest>`.

Validation:
- `articleText` must be string.
- `userMessage` must be string.
- `chatHistory` must be array.

Internal variables created:
- Trace fields:
  - `routerNeedWeb`, `routerReason`, `routerSuggestedQueries`
  - `searchCalled`, `searchQueries`, `searchSources`, `searchError`
  - `answerText`
  - `latencyRouterMs`, `latencySearchMs`, `latencyAnswerMs`

Sanitized history:
- `sanitizedHistory = body.chatHistory.map(...)`
- Coerces role to `'user' | 'assistant'`, content to string.

### Step 2: Router decision
File: `src/lib/gemini.ts`, function `checkSufficiency(articleText, userMessage, chatHistory)`

Called from:
- `routing = await checkSufficiency(body.articleText, body.userMessage, sanitizedHistory)`

What it does:
1. Truncates article to 3k chars for routing prompt (`condensed`).
2. Includes last 2 chat turns as context.
3. Builds router user prompt string.
4. Calls `generateJSON({...})` with:
- `system: ROUTER_PROMPT`
- `user: userPrompt`
- `maxTokens: 200`
- `model: MODEL_ROUTER` env or default.

5. `generateJSON` in `src/lib/llm/index.ts`:
- Calls Anthropic via retry.
- Parses JSON robustly (`safeParseJson`).
- Retries once with stricter JSON instruction if parse fails.

Return value:
```ts
{
  need_web: boolean,
  reason: string,
  suggested_queries: string[],
  must_cite: boolean
}
```

Fallback on error:
- Returns `DEFAULT_RESULT` (`need_web=false`, empty queries).

### Step 3: Conditional search
Files: `src/app/api/chat/route.ts` + `src/lib/search.ts`

Condition:
- Search runs only if:
  - `isSearchAvailable()` is true (`TAVILY_API_KEY` present), and
  - `routing.need_web === true`, and
  - `routing.suggested_queries.length > 0`

3A. Query enhancement:
- `searchQueries = enhanceSearchQuery(routing.suggested_queries, articleTitle, body.userMessage)`
- Returns 1-2 enriched queries with title+question keywords.

3B. Tavily retrieval:
- `const { results, timedOut } = await searchTavily(searchQueries, body.userMessage)`

searchTavily internals:
1. Slice to 2 queries.
2. POST Tavily API for each query.
3. Timeout race at 8s.
4. For each result:
- require valid URL (`hasUrl`)
- canonicalize URL
- block blocked domains
- parse safe title/snippet
- compute credibility + relevance
- dedupe by canonical URL
5. Sort and select top 5.
6. Enrich selected with full text extraction fallback chain.
7. Return:
```ts
{ results: SearchResult[], timedOut: boolean }
```

3C. Build LLM web context:
- If `results.length > 0`:
  - `searchContext = formatSearchResultsForLLM(results)`
  - `searchSources = results.map(({title,url,source}) => ...)`

### Step 4: Answer generation
Files: `src/app/api/chat/route.ts` + `src/lib/gemini.ts`

Call:
- `answerText = await generateChatResponse(articleText, sanitizedHistory, userMessage, searchContext)`

generateChatResponse internals:
1. Truncates article to 10k chars.
2. Builds `system` prompt:
- base `SYSTEM_PROMPT`
- appended `=== ARTICLE TEXT ===`
- if `searchContext` exists, append `searchContext` + `STRICT_SOURCES_INSTRUCTION`

3. Calls `generateText({...})` with:
- `model: MODEL_TUTOR`
- `system`
- `user: userMessage`
- `history: chatHistory`
- `maxTokens: 900`

4. Post-processing when `searchContext` exists:
- remove `[1] [2] ...` markers via `stripNumericMarkers`
- if no Sources section near end:
  - parse source titles+urls from `searchContext`
  - append deterministic markdown Sources section

5. Returns answer string.

Error mapping:
- timeout -> throw `LLM_TIMEOUT`
- rate/quota -> throw `QUOTA_EXCEEDED`
- token length -> throw `TOKEN_OVERFLOW`

### Step 5: Sources validation and repair in route
File: `src/app/api/chat/route.ts`

Condition:
- if `searchCalled && searchSources?.length > 0`

Validation:
- `hasValidSourcesSection(answerText)` checks:
  - no numeric citation markers `[1]`
  - Sources/Source/References header near end (last 30%)
  - at least one URL in that section

Repair flow:
1. If invalid, call `repairSourcesInAnswer(answerText, searchContext)`.
2. If repaired answer valid, use it.
3. Else append fallback deterministic sources from `searchSources`.

### Step 6: Timeout note append
- If `searchTimedOut === true`, route appends article-only disclaimer block.

### Step 7: Trace persistence and response

Trace insert:
- Builds `ChatTrace` object with all stage metadata + latencies.
- Calls `insertChatTrace(trace)` without awaiting.

HTTP response:
- Success: `200 { assistantMessage: answerText }`
- Error: mapped status
  - `504` for `LLM_TIMEOUT`
  - `429` for `QUOTA_EXCEEDED`
  - `413` for `TOKEN_OVERFLOW`
  - else `500`
- Error path also writes trace with `answer_text: ERROR: ...`.

---

## 5) All System Prompts and What They Do

This section lists the prompts in code and their purpose.

## 5.1 Production prompts

### A) Router prompt
Location: `src/lib/gemini.ts` (`ROUTER_PROMPT`)

Purpose:
- Decide if article alone is sufficient (`need_web`).
- Return structured JSON with reason + suggested web queries + `must_cite`.

Expected output schema:
```json
{
  "need_web": true,
  "reason": "...",
  "suggested_queries": ["..."],
  "must_cite": true
}
```

### B) Tutor/system answer prompt
Location: `src/lib/gemini.ts` (`SYSTEM_PROMPT`)

Purpose:
- Define writing style and grounding behavior.
- Instruct model to prioritize article text.
- Use web context only when provided.
- Avoid fabrication.

### C) Strict sources instruction (appended only when searchContext exists)
Location: `src/lib/gemini.ts` (`STRICT_SOURCES_INSTRUCTION`)

Purpose:
- Force answer to end with markdown `Sources:` section.
- Forbid numeric markers like `[1]` in body.
- Require real URLs from provided results.

### D) Sources repair prompt pair
Location: `src/lib/gemini.ts`, function `repairSourcesInAnswer`

Prompts:
- `repairSystem`
- `repairUser`

Purpose:
- Last-resort editor step to fix source formatting without changing content semantics.
- Remove numeric markers and append compliant Sources section.

### E) JSON strictness instructions (internal wrapper)
Location: `src/lib/llm/index.ts`, function `generateJSON`

Purpose:
- Appends JSON-only constraints to any system prompt.
- Retries with stricter minified JSON instruction on parse failure.

## 5.2 Eval-only prompts (not user-facing app runtime)
Location: `scripts/eval/run_eval.ts`

1. Eval router `ROUTER_PROMPT`
- Used by benchmark harness to simulate routing decisions.

2. Eval tutor `SYSTEM_PROMPT`
- Used by benchmark harness for answer generation scoring runs.

3. Judge prompts
- `shouldSearchPrompt(...)`
- `completenessPrompt(...)`
- `unsupportedPrompt(...)`

Purpose:
- Automatically grade router correctness, completeness, and unsupported claims.

---

## 6) Data Contracts and Key Variables

### Chat request payload
Type: `ChatRequest` in `src/types/index.ts`
```ts
{
  session_id: string;
  article_id: string;
  article_title?: string;
  articleText: string;
  chatHistory: ChatMessage[];
  userMessage: string;
  thread_id: string;
}
```

### Chat response payload
Type: `ChatResponse`
```ts
{ assistantMessage: string }
```

### Search result object
Type: `SearchResult` in `src/lib/search.ts`
```ts
{
  title: string;
  url: string;
  snippet: string;
  content: string;
  source: string;
  score: number;
  extractionOk?: boolean;
}
```

### Trace record
Type: `ChatTrace` in `src/lib/traces.ts`
- Stores complete stage-level observability fields.

---

## 7) Failure Points and Debugging Checklist

### Router issues
Check:
- Trace fields: `router_need_web`, `router_reason`, `router_suggested_queries`.
- Prompt suitability in `ROUTER_PROMPT`.
- JSON parse fallback usage (`DEFAULT_RESULT` silently disables search).

### Search issues
Check:
- `TAVILY_API_KEY` present (`isSearchAvailable`).
- `search_called` and `search_error` in traces.
- URL skips due to missing/invalid fields.
- Search timeout path (`timedOut`).
- `SEARCH_DEBUG=1` logs in `logs/search_debug.log`.

### Citation issues
Check:
- Whether `searchContext` existed.
- Whether `hasValidSourcesSection` failed.
- Whether `repairSourcesInAnswer` was called and succeeded.
- Final output has markdown links and trailing Sources section.

### Truthfulness/process mismatch issues
Check:
- If `search_called=false`, answer should not claim web search happened.
- Validate answer text against trace metadata.

### LLM reliability issues
Check:
- Rate limiter waits (`[limiter]`).
- Retry warnings (`[retry]`).
- Error mapping to `LLM_TIMEOUT`, `QUOTA_EXCEEDED`, `TOKEN_OVERFLOW`.

### Production 405/500-style route issues
Check:
- API routes use `runtime='nodejs'` and `dynamic='force-dynamic'`.
- Function logs for import-time exceptions.
- Build output includes `ƒ /api/chat`.

---

## 8) Environment Variables and Their Effect

Required/important:
- `GUARDIAN_API_KEY`: Guardian content requests.
- `ANTHROPIC_API_KEY`: all LLM calls.
- `MODEL_ROUTER`: router model name.
- `MODEL_TUTOR`: tutor model name.
- `LLM_MIN_DELAY_MS`: global LLM min gap.
- `TAVILY_API_KEY`: enables search path.
- `DATABASE_URL`: enables metrics and trace persistence.

Optional/debug:
- `SEARCH_DEBUG=1`: detailed search JSONL debug logs.

---

## 9) Practical “How to Debug Clarity Issues” Playbook

1. Open `/debug/traces` and pick failing thread.
2. Confirm router correctness:
- Was `need_web` reasonable for question intent?
- Did fallback default happen?

3. If search used:
- Inspect `search_sources` quality and domain credibility.
- Inspect `search_error` and timeout behavior.

4. Inspect answer:
- Is it grounded in article first?
- If external facts are present, are URLs present and valid?
- Does answer claim actions not actually taken?

5. Correlate latency:
- High `latency_router_ms`, `latency_search_ms`, `latency_answer_ms` indicates bottleneck stage.

6. Reproduce with same payload:
- Use trace payload values (`article_id`, `thread_id`, `user_message`, etc.) and rerun locally.

7. If issue is systematic:
- Router calibration problem -> adjust router prompt/rules.
- Retrieval relevance problem -> tune query enhancement/scoring.
- Citation compliance problem -> tighten source post-processing/repair rules.

---

This document should give you enough structure to debug where clarity breaks: router decision quality, retrieval quality, response grounding, or citation post-processing.
