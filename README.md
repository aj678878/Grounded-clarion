# Clarion

## Overview

Clarion is a web application that converts Guardian news articles into interactive learning experiences.

Users can:
- Browse a balanced news feed
- Open a full article
- Ask contextual follow-up questions
- Mark when their question has been clarified

The purpose of the application is to improve understanding of complex financial, geopolitical, and technical news topics through conversational assistance Clarion in the article text.

---

## Product Goals

Primary Goal:
Enable users to better understand news articles through contextual Q&A.

Success Metric:
Clarity Resolution Rate (CRR)

CRR =
Number of conversation threads marked "Clear"
/
Number of threads with explicit feedback

A thread begins when a user asks a new question and ends when the user marks it as Clear.

---

## User Experience

### Landing Page

- Automatically loads top 30 Guardian articles
- Balanced across:
  - Business
  - World
  - Technology
  - India (via keyword query)
- Sorted by recency within each category
- "Load 30 more" appends additional articles
- Optional topic search overrides balanced feed

### Article Page

Layout:
- 80% article content
- 20% chat sidebar

Features:
- Full article body
- Chat input
- Clear button below assistant responses
- "New question" button to start a new thread
- Back to Feed navigation

Chat history is session-based and does not persist after navigation.

---

## Conversational Behavior

### Autonomous Tool-Use Routing

Each user message triggers a two-step workflow:

**Step A — Sufficiency Router:**
A lightweight Claude Haiku call (~200 output tokens) evaluates whether the article contains enough information to answer the question. It outputs a structured decision:
- `need_web` — whether a web search is required
- `suggested_queries` — 1–2 search queries if web context is needed
- `must_cite` — whether the response requires source citations

**Step B — Response Generation:**
- If `need_web = false`: the tutor answers from the article only.
- If `need_web = true`: the system calls Tavily with the suggested queries, retrieves up to 3 credible sources, and passes them to Claude alongside the article. The response is structured as:
  - **From the article:** — information drawn from the Guardian article.
  - **Additional context:** — information from web sources, with cited URLs.
- If `TAVILY_API_KEY` is not configured: the tutor provides brief general background labeled as such, but keeps it minimal.

### Threading

- Follow-up questions are treated as continuation of the same thread.
- A new thread begins when the user clicks "New question" or when there is no active thread on the page.
- The Clear button marks a thread as resolved.

No unrelated-question policing is implemented.

### Source Policy

When providing additional context from web sources, the tutor:
- Prefers official/primary sources (government sites, regulators, parliamentary committees).
- For politics/economics, prioritizes: gov.uk, parliament.uk, Reuters, AP, BBC, FT, WSJ, Economist.
- Uses Wikipedia only for basic definitions.
- Uses at most 3 sources per answer.
- Scores sources by domain credibility and selects the highest-quality results.
- Never fabricates sources or URLs.
- If sources conflict, states both viewpoints and cites each.

### Rate Limiting & Timeouts

**Anthropic free tier throttling:**
- The app enforces a global minimum delay between LLM API calls (default 13 s, configurable via `LLM_MIN_DELAY_MS`).
- This keeps usage safely under the Anthropic free-tier limit of 5 requests per minute.
- All LLM calls (router + answer generation) share the same limiter.
- Transient errors (429, 503, timeouts) are retried with exponential backoff (2 s → 4 s → 8 s, max 3 attempts).

**Timeouts:**
- Tavily web search: 8-second timeout.
- If search times out or returns weak results, the tutor returns an article-only answer with a note suggesting the user retry.

---

## Technical Stack

Frontend & Backend:
- Next.js (App Router)
- Deployed on Vercel

APIs:
- Guardian Content API (article data)
- Anthropic Claude API (LLM for conversational responses — Haiku model)
- Tavily Search API (autonomous web context lookup)

Database:
- Vercel Postgres (metrics persistence)

---

## API Design

GET /api/feed
- Fetch balanced Guardian sections
- Deduplicate results
- Paginate

GET /api/article?id=<guardianId>
- Fetch full article body
- Cache by article ID (session-level)

POST /api/chat
- Inputs:
  - articleText
  - chatHistory
  - userMessage
- Internally (autonomous two-step routing):
  1. Sufficiency router (Claude Haiku, ~200 tokens) → decides if web search is needed
  2. If needed → Tavily search (≤8 s, max 2 queries, top 3 credible sources)
  3. Response generation (Claude Haiku, article ± search context, ≤900 tokens)
- Returns:
  - assistantMessage (with cited sources when web context is used)

POST /api/metric
- Logs:
  - thread_started
  - turn_added
  - clear_clicked

---

## Metrics Tracked

1. Clarity Resolution Rate
2. Average Turns to Resolution
3. P95 Tutor Response Latency

---

## Failure Handling

Guardian API failure:
- Retry twice automatically
- Show structured error message

API quota exceeded:
- Display user-friendly message

LLM timeout:
- Display retry option

Token overflow:
- Display conversation limit message

---

## Design Principles

- Calm and minimal interface
- Fast loading
- No unnecessary complexity
- Clear conversational grounding
- Empower users to understand what they read

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
4. Set up the database (optional for initial testing — the app works without it, metrics just won't persist):
   - Create a Vercel Postgres database or use any PostgreSQL instance
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

---

## Debug: Trace Viewer

Every tutor-mode chat interaction is logged as a trace in the `chat_traces` Postgres table. A built-in debug page lets you inspect recent traces.

**URL:** `/debug/traces`

- In development: accessible directly at [http://localhost:3000/debug/traces](http://localhost:3000/debug/traces)
- In production: gated by query parameter — access via `/debug/traces?key=debug`

**Each trace shows:**
- Timestamp, article ID, thread ID
- User message
- Router decision (`need_web`, reason, suggested queries) + latency
- Search status (called/skipped, sources list, errors) + latency
- Answer text (collapsible), character count, citations present
- Full latency breakdown: router → search → answer → total (ms)

Traces are persisted even on errors (with `answer_text` prefixed `ERROR:`).

---

## Deployment (Vercel)

1. Push to GitHub
2. Import the repo in [Vercel](https://vercel.com)
3. Add environment variables:
   - `GUARDIAN_API_KEY`
   - `ANTHROPIC_API_KEY`
   - `MODEL_TUTOR=claude-3-haiku-20240307`
   - `MODEL_ROUTER=claude-3-haiku-20240307`
   - `LLM_MIN_DELAY_MS=13000` — rate-limit gap (Anthropic free tier: 5 RPM)
   - `DATABASE_URL` (auto-set if using Vercel Postgres integration)
   - `TAVILY_API_KEY` — enables autonomous web context lookup (optional, recommended)
4. Deploy

