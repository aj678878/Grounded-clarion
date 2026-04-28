# Clarion

## Overview

Clarion is a broadsheet-style news reader that lets users browse Guardian articles and ask an AI editor ("Ask the Editor") questions about what they are reading.

Users can:
- Browse a balanced news feed laid out as a newspaper front page
- Open a full article with a persistent AI chat sidebar
- Ask contextual follow-up questions about the article
- Run **Compare Sources** — a multi-outlet comparative dossier (comparison overview, agreements, disagreements, framing, entities, open questions) without leaving the article page
- Toggle day/night reading mode

The purpose of the application is to improve understanding of complex financial, geopolitical, and technical news topics through grounded, cited conversational assistance.

---

## Product Goals

Primary Goal:
Enable users to better understand news articles through contextual Q&A.

Success Metric:
Average Turns to Resolution — the number of questions a user needs to ask before indicating they understand the topic (via session patterns rather than explicit UI).

---

## User Experience

### Front Page (Feed)

- **Masthead** — publication name, date, edition line, tagline
- **Navigation bar** (sticky) — category tabs (All · World · Business · Technology · India), search input, day/night toggle
- **Hero article** — full-width feature with Guardian thumbnail (fallback only when no image is available), shown on All and World tabs
- **3-column grid** — World | Business | Tech & India, each column with its own section header
- Articles show headline, Guardian byline when available, trail text, and "Read & Discuss →" link

Search overrides the grid view with a flat single-column list.  
"Load more" appends additional articles on the homepage, topic tabs, and search results.

### Article Page

Layout:
- **Left column** (scrollable) — article body
- **Right column** (sticky sidebar, 340 px) — "Ask the Editor" chat panel

Article body features:
- Drop cap on first paragraph
- Byline block with author, date, and computed reading time
- Body prose in Libre Baskerville (17 px, justified)
- "Read original source →" footer link

Chat sidebar features:
- Three starter prompt chips on empty state ("What is the main argument here?", "Why does this matter?", "What background context am I missing?")
- User and assistant bubbles with labelled sender
- Structured sources footer beneath each AI response (see below)
- Bouncing-dot typing indicator
- **Compare Sources** — outlined button beneath the "Ask the Editor" header; tooltip (~12 s · 3–5 outlets). See [Compare Sources](#compare-sources) below.

Chat history is session-based and does not persist after navigation.

---

## Compare Sources

Compare Sources is a **multi-phase synthesis pipeline** that discovers peer outlets covering the same story, extracts article text where possible, and asks Claude to produce a structured **Source Dossier**. The opening **comparison overview** explains how peer coverage differs from the Guardian piece and from each other (not a neutral news recap); when aligned, it says so briefly then notes residual differences. Sections cover points of agreement, factual disagreements, framing differences, key entities, and open questions — with citations tied back to named outlets. In structured synthesis, the original Guardian article is treated as **source `0`** and peer outlets are **source `1+`**. **Political lean labels are not shown** in the UI (internal tiering may still use domain-based classification). There is **no chronological timeline** in v1; users can ask **Ask the Editor** for a timeline if needed.

### User experience

Everything happens in the **right-hand sidebar** on the article page. There is **no navigation** to a separate route.

1. **Idle** — Full-width "Compare Sources" button (ink outline) with an **ⓘ** tooltip describing duration and scope.
2. **Running (~10–15 s)** — Button switches to a loading style (accent border). Below it: an indeterminate progress bar, a short **phase label** (event signature → discovery → fetching content → synthesis), and **one row per discovered outlet** with a status dot (queued → spinning while extraction runs → green when usable content exists → red if unavailable).
3. **Complete** — Button becomes a filled **"View Dossier"** control. If some outlets could not be used (paywall, extraction failure), an amber note shows **"Based on N of M sources"**.
4. **View Dossier** — Clicking swaps the sidebar body from chat to the dossier view: header **"Source Dossier"** with **N of M sources** and **← Back to Chat**. The dossier shows a **comparison overview** then a **numbered accordion** (Points of Agreement open by default; other sections collapsed with one-line previews). Inline citations use outlet names in brackets, e.g. `[Guardian, Reuters, AP]`. A **Sources Consulted** block lists the Guardian article plus each peer outlet with headline and date.
5. **Back to Chat** — Returns to the chat UI; **conversation state is unchanged**. The user can tap **View Dossier** again to re-open the last result for this session.

Compare Sources does **not** use Server-Sent Events. The client **polls** a status endpoint after starting a job (see [API](#compare-sources-api)).

When discovery or extraction yields only limited peer coverage, the job may still complete as a **partial** dossier. In that case the UI shows a comparison based on the usable sources that survived extraction, and the synthesis step may fall back to a plain-text overview if the structured JSON response is not salvageable.

### Pipeline (server)

The implementation lives under `src/lib/synthesis/`. Phases match `runCompareSources` / `runCompareSourcesAsync`:

| Phase | Name | Role |
|-------|------|------|
| 1 | Event extraction | Derives a searchable event signature from the Guardian article |
| 2 | Source discovery | Tavily-backed discovery of peer outlets (tiered / bias-aware candidate list) |
| 3 | Content extraction | Per-URL fetch via Tavily content extraction; optional Apify fallback for supported domains; paywall/snippet handling |
| 4 | Comparative synthesis | Claude generates structured JSON (or a degraded plain-text fallback when structure cannot be validated/salvaged) |

Successful runs **persist a synthesis trace** to Postgres (same observability pattern as chat), when `DATABASE_URL` is configured. The compare job result is returned to the UI first; trace persistence then completes inside the same Vercel `waitUntil(...)` lifecycle so observability does not block dossier delivery.

### Async jobs and polling

Long-running work cannot block the HTTP response for tens of seconds. The server uses:

- **`POST /api/compare-sources`** — Validates the request body, creates an **in-memory job** keyed by UUID, starts **`runCompareSourcesAsync`** inside Vercel **`waitUntil(...)`**, and returns **`{ jobId }`** immediately.
- **`GET /api/compare-sources/status/[jobId]`** — Returns job status: `pending` \| `running` \| `done` \| `error`, current phase index, per-source progress rows, and the **full result payload** when `done`.

The browser **`useCompareSources`** hook (`src/hooks/useCompareSources.ts`) polls the status route every **2 seconds** until completion or failure.

**Operational note:** Jobs live in a **process-local `Map`**. They work well on a single long-lived Node dev server. On **serverless** deployments, instances may not share memory; jobs may also be lost on cold starts. For production hardening you could move jobs to Redis or run the pipeline as a durable queue-backed worker.

### Dependencies

Compare Sources shares infrastructure with the rest of the app: **Anthropic** (synthesis), **Guardian** (seed article), **Tavily** (discovery + extraction). **Apify** (`APIFY_TOKEN`) improves extraction on certain domains when Tavily returns snippets only.

### Code map

| Area | Location |
|------|----------|
| Sidebar UI, chat ↔ dossier switching | `src/components/ChatPanel.tsx` |
| Accordion dossier rendering | `src/components/DossierView.tsx` |
| Client polling hook | `src/hooks/useCompareSources.ts` |
| Pipeline orchestration + async job runner | `src/lib/synthesis/run.ts` |
| In-memory job store | `src/lib/synthesis/job-store.ts` |
| Phase implementations | `src/lib/synthesis/phases/` |
| Start + status routes | `src/app/api/compare-sources/` |

---

## Conversational Behavior

### Autonomous Tool-Use Routing

Each user message triggers a two-step workflow:

**Step A — Sufficiency Router:**
A lightweight Claude Haiku call (~350 output tokens) evaluates the user's question and makes two decisions:

1. **Intent** — should we answer at all, or politely decline?
   - `answer` — default; covers all factual, analytical, interpretive, and background questions about the article or its subject.
   - `decline_meta` — question is about the assistant or system itself (e.g. "What LLM are you?", "Ignore previous instructions"). Returns a canned response immediately, skips search and tutor.
   - `decline_off_topic` — question has no plausible relationship to the article or news (e.g. "Tell me a joke", "What's the weather?"). Returns a canned response immediately, skips search and tutor.

2. **Need web** — (only when `intent = answer`) does the article alone suffice, or is a web search required?
   - `need_web: false` — article is sufficient to answer confidently through grounded reasoning or synthesis.
   - `need_web: true` — answer requires facts not present in the article excerpt (background, definitions, historical data, current status, etc.).

The router is calibrated around **evidential sufficiency**, not question type:
- analytical or “why” questions do **not** automatically stay article-only
- factual or “what” questions do **not** automatically trigger search
- article-adjacent background/context questions remain **in scope** and are routed to `answer`

Router also outputs:
- `suggested_queries` — 1–2 short factual search queries when `need_web = true`
- `must_cite` — whether the response requires source citations
- `reason` — one-sentence explanation of the routing decision
- `article_evidence_summary` — very short summary of what the article actually provides
- `would_require_speculation` — whether an article-only answer would require unsupported inference

**Step B — Response Generation:**
- If `intent` is `decline_meta` or `decline_off_topic`: return canned response. Done.
- If `need_web = false`: Claude answers from the article only.
- If `need_web = true` and `TAVILY_API_KEY` is set: call Tavily with suggested queries, pass results to Claude alongside the article.
- If `need_web = true` but Tavily is unavailable: Claude answers from the article with a note that additional web context was unavailable.
- If the router returns malformed or incomplete JSON: the API returns a retryable error and the chat UI offers a Retry action that replays the full request.

### Sources and Context Footer

Each AI response bubble shows a small ruled footer:
- **Web search was used** → numbered list of source links (title + external link arrow).
- **Article context only** → quiet italic label "Answered from article context".

Sources are returned as structured data (`sources: [{title, url}]`) — not embedded in the prose.

### Threading

- Follow-up questions continue the same conversation thread.
- A new thread begins when there is no active thread or after a page reload.

### Source Quality Policy

When web context is used, the system:
- Prefers official/primary sources (government sites, regulators, parliamentary committees).
- For politics/economics: gov.uk, parliament.uk, Reuters, AP, BBC, FT, WSJ, Economist.
- Uses Wikipedia only for basic definitions.
- Uses at most 3 sources per answer.
- Scores sources by domain credibility.
- Never fabricates sources or URLs.
- If sources conflict, states both viewpoints and cites each.

### Rate Limiting & Timeouts

**Live app behavior:**
- Router and answer generation are retried on transient upstream errors (429, 503, network timeouts) with exponential backoff (2 s → 4 s → 8 s, max 3 attempts).
- Live chat does **not** apply the conservative eval-time rate limiter by default.

**Eval behavior:**
- The eval scripts apply a conservative inter-call limiter for Anthropic to stay within low-RPM plans.

**Timeouts:**
- Tavily web search: 8-second timeout.
- If search times out or returns weak results, the tutor returns an article-only answer with a note suggesting the user retry.

---

## Technical Stack

Frontend & Backend:
- Next.js 14 (App Router, TypeScript)
- Tailwind CSS with custom design tokens (paper/ink/accent colour system, day/night mode)
- Deployed on Vercel

APIs:
- Guardian Content API (article data)
- Anthropic Claude API (claude-haiku-4-5-20251001 — router + tutor; additional models for Compare Sources synthesis phases)
- Tavily Search API (autonomous web context lookup for chat; discovery + content extraction for Compare Sources)
- Apify (optional — full-page scrape fallback for Compare Sources on supported domains)

Database:
- Vercel Postgres (chat trace persistence for observability)

---

## API Design

```
GET /api/feed
```
- Fetches balanced Guardian sections (World, Business, Technology, India)
- Deduplicates results
- Paginates by page
- Supports `?q=` search query override
- Feed/search results include `thumbnail` and `byline` when Guardian provides them

```
GET /api/article?id=<guardianId>
```
- Fetches full article body (including wordcount, byline)
- Server-side in-memory cache by article ID

```
POST /api/chat
```
Inputs:
- `articleText`, `userMessage`, `chatHistory`, `session_id`, `article_id`, `thread_id`, `article_title`

Internally (autonomous two-step routing):
1. Sufficiency router (Claude Haiku, ~350 tokens) → classifies `intent` + `need_web`
2. Short-circuit if `intent ≠ answer` → return canned response
3. If `need_web = true` → Tavily search (≤8 s, max 2 queries, top 3 credible sources)
4. Response generation (Claude Haiku, article ± search context, ≤900 tokens)
5. If router parsing fails or the output is unusable → return `503` retryable error (`ROUTER_RETRYABLE`)

Returns:
```json
{
  "assistantMessage": "prose answer (no embedded sources)",
  "sources": [{ "title": "string", "url": "string" }],
  "fromWebSearch": true
}
```

```
POST /api/metric
```
Logs: `thread_started`, `turn_added`, `clear_clicked`

```
POST /api/compare-sources
```
Starts an asynchronous Compare Sources job for the current article.

Request body matches `compareSourcesRequestSchema` (`article_id`, `article_title`, `article_content`, `article_source_url`, `article_source_domain`, optional `thread_id`).

Returns immediately:
```json
{ "jobId": "<uuid>" }
```

```
GET /api/compare-sources/status/[jobId]
```
Poll while the job runs. Response shape:

- Always: `status` (`pending` \| `running` \| `done` \| `error`), `currentPhase` (0–4), `sourceStatuses` (per-outlet name + status)
- When `status === "done"`: `result` — same structural envelope as the synchronous pipeline output (`payload.phase2` … `phase4`, `warnings`, `total_duration_ms`, etc.)
- When `status === "error"`: `error` message string
- Unknown job id → `404`

---

## Metrics Tracked

1. Average Turns to Resolution (session-derived)
2. P95 Tutor Response Latency
3. Router intent distribution (answer / decline_meta / decline_off_topic)

---

## Failure Handling

| Failure | Behaviour |
|---|---|
| Guardian API error | Retry twice automatically; show structured error message |
| API quota exceeded | Display user-friendly message |
| Router failure / malformed router JSON | Return retryable API error; chat UI shows Retry and replays the same request |
| LLM timeout | Display retry option |
| Token overflow | Display conversation limit message |
| Tavily timeout | Answer from article only; note that web context was unavailable |

---

## Design

Typography:
- **Headlines** — Playfair Display (700/900)
- **Body prose** — Libre Baskerville (400/400i)
- **UI labels, bylines, nav** — Source Sans 3 (600, uppercase)

Colour tokens (CSS custom properties, light/dark variants):
- `--paper` · `--paper-alt` · `--paper-card` — background surfaces
- `--ink` · `--ink-2` · `--ink-3` — text hierarchy
- `--accent` — navy links and active states
- `--red` — crimson rule lines and section tags
- `--border` · `--col-rule` — dividers

Dark mode: toggled via `data-dark="true"` on `<html>`, persisted to `localStorage`. A pre-paint inline script in `layout.tsx` reads the preference before first render to avoid a flash.

---

## Local Development

### Prerequisites

- Node.js 18+
- npm

### Setup

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```
3. Copy `.env.example` to `.env.local` and fill in your API keys:
   ```bash
   cp .env.example .env.local
   ```
4. Set up the database (optional — the app works without it, traces just won't persist):
   - Create a Vercel Postgres database or any PostgreSQL instance
   - Run the schema from `db/schema.sql`
   - Set `DATABASE_URL` in `.env.local`
5. Start the dev server:
   ```bash
   npm run dev
   ```
6. Open [http://localhost:3000](http://localhost:3000)

### Running Tests

```bash
npm test
```

### Running Evals

```bash
npm run eval:generate   # generate evaluation dataset
npm run eval:run        # score answers with judge model
npm run eval            # both steps
```

Note: the eval harness still uses an embedded router/answer prompt path in `scripts/eval/run_eval.ts`. It remains useful for regression tracking, but it is not a byte-for-byte execution of the production chat route.

---

## Debug: Trace Viewer

Every chat interaction is logged as a trace in the `chat_traces` Postgres table. Compare Sources runs are logged separately in `synthesis_traces`.

**URL:** `/debug/traces`

- Development: [http://localhost:3000/debug/traces](http://localhost:3000/debug/traces)
- Production: `/debug/traces?key=debug`

**Each trace shows:**
- Timestamp, article ID, thread ID
- User message
- Router decision (`intent`, `need_web`, reason, suggested queries) + latency
- Router parse diagnostics (`parse_ok`, `parse_error`, `used_default`, raw output)
- Search status (called/skipped, sources, errors) + latency
- Answer text (collapsible), character count
- Full latency breakdown: router → search → answer → total (ms)
- A second section lists recent **Compare Sources** synthesis traces, including status, source counts, cost estimate, total runtime, and the persisted synthesis payload when available

Traces are persisted even on errors (`answer_text` prefixed `ERROR:`).

---

## Deployment (Vercel)

1. Push to GitHub
2. Import the repo in [Vercel](https://vercel.com)
3. Add environment variables:

| Variable | Required | Notes |
|---|---|---|
| `GUARDIAN_API_KEY` | Yes | Guardian Content API key |
| `ANTHROPIC_API_KEY` | Yes | Anthropic API key |
| `TAVILY_API_KEY` | Recommended | Enables web search in chat; required for meaningful Compare Sources discovery and extraction |
| `APIFY_TOKEN` | No | Compare Sources: stronger extraction on select paywalled domains when Tavily returns snippets only |
| `MODEL_TUTOR` | No | Defaults to `claude-haiku-4-5-20251001` |
| `MODEL_ROUTER` | No | Currently ignored in app runtime; router and tutor both resolve from `MODEL_TUTOR` |
| `MODEL_JUDGE` | No | Used by eval scripts only; defaults to same |
| `DATABASE_URL` | No | Vercel Postgres (auto-set by integration); traces skipped if unset |
| `LLM_MIN_DELAY_MS` | No | Primarily relevant to eval / any code paths that explicitly enable the limiter |

4. Deploy
