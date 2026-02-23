/* ------------------------------------------------------------------ */
/*  POST /api/chat — Two-step autonomous tool-use routing             */
/*  with full trace logging for observability.                        */
/*                                                                    */
/*  Step A: Sufficiency router (Gemini, ~150 tokens, ≤5 s)            */
/*  Step B: If need_web → Tavily search (≤8 s, max 2 queries, 3 src) */
/*  Step C: Response generation (Gemini, article ± search context)    */
/*  Step D: Persist trace to chat_traces table                        */
/* ------------------------------------------------------------------ */

import { NextRequest, NextResponse } from 'next/server';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { checkSufficiency, generateChatResponse, repairSourcesInAnswer } from '@/lib/gemini';
import {
  searchTavily,
  isSearchAvailable,
  formatSearchResultsForLLM,
  enhanceSearchQuery,
} from '@/lib/search';
import { insertChatTrace, type ChatTrace } from '@/lib/traces';
import { ChatRequest } from '@/types';

/** Detect citations in the answer: at least one markdown link [text](url). */
function hasCitations(text: string): boolean {
  return /\[.+?\]\(https?:\/\/.+?\)/.test(text);
}

/** Check if answer has a Sources section near the end (last 30%) with at least one URL and no [1],[2] markers. */
function hasValidSourcesSection(text: string): boolean {
  // Reject if numeric markers like [1], [2] are present anywhere
  if (/\[\d+\]/.test(text)) return false;

  const headerPattern = /(?:^|\n)\s*\**(?:Sources|Source|References)\**\s*:?/gi;
  let lastHeaderIndex = -1;
  let match: RegExpExecArray | null;
  while ((match = headerPattern.exec(text)) !== null) {
    lastHeaderIndex = match.index;
  }
  if (lastHeaderIndex < 0) return false;
  if (lastHeaderIndex < text.length * 0.7) return false;
  const sectionText = text.slice(lastHeaderIndex);
  return /https?:\/\/\S+/.test(sectionText);
}

/** Build deterministic fallback Sources section from Tavily results using markdown links. */
function buildFallbackSources(sources: { title: string; url: string }[]): string {
  if (sources.length === 0) return '';
  const top = sources.slice(0, 2);
  const lines = top.map((s, i) => `${i + 1}. [${s.title}](${s.url})`);
  return `\n\n**Sources:**\n${lines.join('\n')}`;
}

export async function POST(request: NextRequest) {
  const totalStart = Date.now();

  // Trace accumulators — always populated, even on error
  let routerNeedWeb: boolean | null = null;
  let routerReason: string | null = null;
  let routerSuggestedQueries: string[] | null = null;
  let searchCalled = false;
  let searchQueries: string[] | null = null;
  let searchSources: { title: string; url: string; domain: string }[] | null = null;
  let searchError: string | null = null;
  let answerText = '';
  let latencyRouterMs: number | null = null;
  let latencySearchMs: number | null = null;
  let latencyAnswerMs: number | null = null;

  // Parsed body fields we need for trace
  let sessionId = '';
  let articleId = '';
  let threadId = '';
  let userMessage = '';

  try {
    const body = (await request.json()) as Partial<ChatRequest>;

    // ---- Input validation ----
    if (!body.articleText || typeof body.articleText !== 'string') {
      return NextResponse.json({ error: 'Missing or invalid: articleText' }, { status: 400 });
    }
    if (!body.userMessage || typeof body.userMessage !== 'string') {
      return NextResponse.json({ error: 'Missing or invalid: userMessage' }, { status: 400 });
    }
    if (!Array.isArray(body.chatHistory)) {
      return NextResponse.json({ error: 'Missing or invalid: chatHistory (must be array)' }, { status: 400 });
    }

    sessionId = String(body.session_id ?? '');
    articleId = String(body.article_id ?? '');
    threadId = String(body.thread_id ?? '');
    userMessage = body.userMessage;
    const articleTitle = String(body.article_title ?? '');

    const sanitizedHistory = body.chatHistory.map((m) => ({
      role: m.role === 'user' ? ('user' as const) : ('assistant' as const),
      content: String(m.content ?? ''),
    }));

    // ---- Step A: Sufficiency router ----
    let searchContext = '';
    let searchTimedOut = false;

    if (isSearchAvailable()) {
      const routerStart = Date.now();
      const routing = await checkSufficiency(
        body.articleText,
        body.userMessage,
        sanitizedHistory
      );
      latencyRouterMs = Date.now() - routerStart;

      routerNeedWeb = routing.need_web;
      routerReason = routing.reason;
      routerSuggestedQueries = routing.suggested_queries;

      console.log('[chat] Router decision:', {
        need_web: routing.need_web,
        reason: routing.reason,
        queries: routing.suggested_queries,
        latency_ms: latencyRouterMs,
      });

      // ---- Step B: Tavily search (if needed) ----
      if (routing.need_web && routing.suggested_queries.length > 0) {
        searchCalled = true;
        searchQueries = enhanceSearchQuery(
          routing.suggested_queries,
          articleTitle,
          body.userMessage
        );

        const searchStart = Date.now();
        try {
          const { results, timedOut } = await searchTavily(searchQueries, body.userMessage);
          searchTimedOut = timedOut;

          if (results.length > 0) {
            searchContext = formatSearchResultsForLLM(results);
            searchSources = results.map((r) => ({
              title: r.title,
              url: r.url,
              domain: r.source,
            }));
          }
        } catch (err) {
          searchError = err instanceof Error ? err.message : String(err);
        }
        latencySearchMs = Date.now() - searchStart;
      }
    }

    // ---- Step C: Generate response ----
    const answerStart = Date.now();
    answerText = await generateChatResponse(
      body.articleText,
      sanitizedHistory,
      body.userMessage,
      searchContext
    );
    latencyAnswerMs = Date.now() - answerStart;

    // ---- Step C.2: Validate Sources section (when web search was used) ----
    // generateChatResponse already does deterministic post-processing (strip markers + append sources).
    // Only call repairSourcesInAnswer as last resort if deterministic enforcement also failed.
    if (searchCalled && searchSources && searchSources.length > 0) {
      if (!hasValidSourcesSection(answerText)) {
        console.log('[chat] Deterministic enforcement insufficient, trying LLM repair…');

        try {
          const repaired = await repairSourcesInAnswer(answerText, searchContext);
          if (hasValidSourcesSection(repaired)) {
            answerText = repaired;
            console.log('[chat] Sources repair succeeded.');
          } else {
            console.log('[chat] Repair still missing Sources, appending fallback.');
            answerText += buildFallbackSources(searchSources);
          }
        } catch {
          console.log('[chat] Repair error, appending fallback Sources.');
          answerText += buildFallbackSources(searchSources);
        }
      }
    }

    // Append timeout note if search failed
    if (searchTimedOut) {
      answerText +=
        '\n\n---\n_I couldn\'t fetch reliable external context right now. The answer above is based on the article only. You can retry for additional sourced context._';
    }

    // ---- Step D: Persist trace (fire-and-forget) ----
    const latencyTotalMs = Date.now() - totalStart;
    const trace: ChatTrace = {
      session_id: sessionId,
      article_id: articleId,
      thread_id: threadId,
      user_message: userMessage,
      router_need_web: routerNeedWeb,
      router_reason: routerReason,
      router_suggested_queries: routerSuggestedQueries,
      search_called: searchCalled,
      search_queries: searchQueries,
      search_sources: searchSources,
      search_error: searchError,
      answer_text: answerText,
      citations_present: hasCitations(answerText),
      answer_char_count: answerText.length,
      latency_router_ms: latencyRouterMs,
      latency_search_ms: latencySearchMs,
      latency_answer_ms: latencyAnswerMs,
      latency_total_ms: latencyTotalMs,
    };

    // Don't await — fire and forget so it doesn't slow the response
    insertChatTrace(trace).catch((err) =>
      console.error('[chat] Trace insert failed:', err)
    );

    return NextResponse.json({ assistantMessage: answerText });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Chat request failed';

    // Still persist a trace for the error case
    const latencyTotalMs = Date.now() - totalStart;
    insertChatTrace({
      session_id: sessionId,
      article_id: articleId,
      thread_id: threadId,
      user_message: userMessage || '(validation failed)',
      router_need_web: routerNeedWeb,
      router_reason: routerReason,
      router_suggested_queries: routerSuggestedQueries,
      search_called: searchCalled,
      search_queries: searchQueries,
      search_sources: searchSources,
      search_error: searchError || message,
      answer_text: `ERROR: ${message}`,
      citations_present: false,
      answer_char_count: 0,
      latency_router_ms: latencyRouterMs,
      latency_search_ms: latencySearchMs,
      latency_answer_ms: latencyAnswerMs,
      latency_total_ms: latencyTotalMs,
    }).catch(() => {});

    if (message === 'LLM_TIMEOUT') {
      return NextResponse.json({ error: 'LLM_TIMEOUT' }, { status: 504 });
    }
    if (message === 'QUOTA_EXCEEDED') {
      return NextResponse.json(
        { error: 'Rate limit hit, please retry in ~15s.' },
        { status: 429 }
      );
    }
    if (message === 'TOKEN_OVERFLOW') {
      return NextResponse.json({ error: 'TOKEN_OVERFLOW' }, { status: 413 });
    }

    console.error('[/api/chat] Error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
