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

import {
  checkSufficiencyWithDebug,
  generateChatResponseWithDebug,
  repairSourcesInAnswer,
} from '@/lib/gemini';
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
  let traceKey = `unknown:unknown:${totalStart}`;
  const debugFlow: Record<string, unknown> = {
    trace_key: traceKey,
    request_meta: {
      started_at: new Date(totalStart).toISOString(),
    },
  };

  const emitFlow = (stage: string, payload: unknown) => {
    console.log('[chat-flow]', JSON.stringify({ traceKey, stage, payload }));
  };

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
    debugFlow.incoming_payload = body;

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
    traceKey = `${sessionId}:${threadId}:${totalStart}`;
    debugFlow.trace_key = traceKey;
    userMessage = body.userMessage;
    const articleTitle = String(body.article_title ?? '');
    debugFlow.request_meta = {
      trace_key: traceKey,
      started_at: new Date(totalStart).toISOString(),
      session_id: sessionId,
      article_id: articleId,
      thread_id: threadId,
      article_title: articleTitle,
      article_text_chars: body.articleText.length,
      user_message_chars: body.userMessage.length,
    };
    emitFlow('request_meta', debugFlow.request_meta);

    const sanitizedHistory = body.chatHistory.map((m) => ({
      role: m.role === 'user' ? ('user' as const) : ('assistant' as const),
      content: String(m.content ?? ''),
    }));
    debugFlow.sanitized = {
      history: sanitizedHistory,
      history_count: sanitizedHistory.length,
      article_title: articleTitle,
      article_text_chars: body.articleText.length,
      user_message: body.userMessage,
    };
    emitFlow('sanitized', debugFlow.sanitized);

    // ---- Step A: Sufficiency router ----
    let searchContext = '';
    let searchTimedOut = false;

    if (isSearchAvailable()) {
      const routerStart = Date.now();
      const routingWithDebug = await checkSufficiencyWithDebug(
        body.articleText,
        body.userMessage,
        sanitizedHistory
      );
      const routing = routingWithDebug.result;
      latencyRouterMs = Date.now() - routerStart;
      debugFlow.router_input = {
        article_excerpt_used: routingWithDebug.debug.article_excerpt_used,
        recent_history_used: routingWithDebug.debug.recent_history_used,
        user_message: body.userMessage,
        model: routingWithDebug.debug.model,
        max_tokens: routingWithDebug.debug.max_tokens,
        user_prompt: routingWithDebug.debug.user_prompt,
      };
      debugFlow.router_output = {
        routing,
        latency_ms: latencyRouterMs,
        parse_ok: routingWithDebug.debug.parse_ok,
        parse_error: routingWithDebug.debug.parse_error,
        raw_output: routingWithDebug.debug.raw_output,
        used_default: routingWithDebug.debug.used_default,
      };
      emitFlow('router_input', debugFlow.router_input);
      emitFlow('router_output', debugFlow.router_output);

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
        debugFlow.search_plan = {
          is_search_available: true,
          need_web: routing.need_web,
          suggested_queries_raw: routing.suggested_queries,
          enhanced_queries: searchQueries,
        };
        emitFlow('search_plan', debugFlow.search_plan);

        try {
          const { results, timedOut, debug } = await searchTavily(searchQueries, body.userMessage);
          searchTimedOut = timedOut;
          if (debug) {
            debugFlow.tavily_request = {
              queries_run: debug.queries_run,
              payloads: debug.tavily_request_payloads,
            };
            debugFlow.tavily_raw_response = debug.tavily_raw;
            debugFlow.search_transform = {
              candidates_count_before_filter: debug.candidates_pre_filter.length,
              candidates_pre_filter: debug.candidates_pre_filter,
              skips: debug.skips,
              scores: debug.scores,
              selected: debug.selected,
              enrichment: debug.enrichment,
            };
            emitFlow('tavily_request', debugFlow.tavily_request);
            emitFlow('tavily_raw_response', debugFlow.tavily_raw_response);
            emitFlow('search_transform', debugFlow.search_transform);
          }

          if (results.length > 0) {
            searchContext = formatSearchResultsForLLM(results);
            searchSources = results.map((r) => ({
              title: r.title,
              url: r.url,
              domain: r.source,
            }));
            debugFlow.search_context_output = {
              search_context: searchContext,
              char_length: searchContext.length,
            };
            emitFlow('search_context_output', debugFlow.search_context_output);
          }
        } catch (err) {
          searchError = err instanceof Error ? err.message : String(err);
        }
        latencySearchMs = Date.now() - searchStart;
      }
    } else {
      debugFlow.search_plan = {
        is_search_available: false,
        need_web: null,
        suggested_queries_raw: [],
        enhanced_queries: [],
        skipped_reason: 'TAVILY_API_KEY not set',
      };
      emitFlow('search_plan', debugFlow.search_plan);
    }

    // ---- Step C: Generate response ----
    debugFlow.answer_input = {
      article_text: body.articleText,
      article_text_chars: body.articleText.length,
      chat_history: sanitizedHistory,
      user_message: body.userMessage,
      search_context: searchContext,
      search_context_chars: searchContext.length,
    };
    emitFlow('answer_input', debugFlow.answer_input);

    const answerStart = Date.now();
    const answerWithDebug = await generateChatResponseWithDebug(
      body.articleText,
      sanitizedHistory,
      body.userMessage,
      searchContext
    );
    answerText = answerWithDebug.answer;
    latencyAnswerMs = Date.now() - answerStart;
    debugFlow.answer_output = {
      initial_raw_model_output: answerWithDebug.debug.raw_model_output,
      generation_debug: answerWithDebug.debug,
      answer_after_generate: answerText,
    };
    emitFlow('answer_output_initial', debugFlow.answer_output);

    // ---- Step C.2: Validate Sources section (when web search was used) ----
    // generateChatResponse already does deterministic post-processing (strip markers + append sources).
    // Only call repairSourcesInAnswer as last resort if deterministic enforcement also failed.
    if (searchCalled && searchSources && searchSources.length > 0) {
      const validBeforeRepair = hasValidSourcesSection(answerText);
      if (!validBeforeRepair) {
        console.log('[chat] Deterministic enforcement insufficient, trying LLM repair…');

        try {
          const repaired = await repairSourcesInAnswer(answerText, searchContext);
          const validAfterRepair = hasValidSourcesSection(repaired);
          if (validAfterRepair) {
            answerText = repaired;
            console.log('[chat] Sources repair succeeded.');
            (debugFlow.answer_output as Record<string, unknown>).repair = {
              attempted: true,
              valid_before_repair: validBeforeRepair,
              repaired_text: repaired,
              valid_after_repair: validAfterRepair,
              fallback_appended: false,
            };
          } else {
            console.log('[chat] Repair still missing Sources, appending fallback.');
            answerText += buildFallbackSources(searchSources);
            (debugFlow.answer_output as Record<string, unknown>).repair = {
              attempted: true,
              valid_before_repair: validBeforeRepair,
              repaired_text: repaired,
              valid_after_repair: validAfterRepair,
              fallback_appended: true,
            };
          }
        } catch {
          console.log('[chat] Repair error, appending fallback Sources.');
          answerText += buildFallbackSources(searchSources);
          (debugFlow.answer_output as Record<string, unknown>).repair = {
            attempted: true,
            valid_before_repair: validBeforeRepair,
            repair_error: true,
            fallback_appended: true,
          };
        }
      } else {
        (debugFlow.answer_output as Record<string, unknown>).repair = {
          attempted: false,
          valid_before_repair: validBeforeRepair,
          fallback_appended: false,
        };
      }
    }

    // Append timeout note if search failed
    if (searchTimedOut) {
      answerText +=
        '\n\n---\n_I couldn\'t fetch reliable external context right now. The answer above is based on the article only. You can retry for additional sourced context._';
    }

    // ---- Step D: Persist trace (fire-and-forget) ----
    const latencyTotalMs = Date.now() - totalStart;
    debugFlow.timing = {
      router_ms: latencyRouterMs,
      search_ms: latencySearchMs,
      answer_ms: latencyAnswerMs,
      total_ms: latencyTotalMs,
    };
    debugFlow.final = {
      response_status: 200,
      citations_present: hasCitations(answerText),
      answer_char_count: answerText.length,
      search_timed_out: searchTimedOut,
    };
    emitFlow('timing', debugFlow.timing);
    emitFlow('final', debugFlow.final);

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
      debug_flow: debugFlow,
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
    const mappedStatus =
      message === 'LLM_TIMEOUT' ? 504 : message === 'QUOTA_EXCEEDED' ? 429 : message === 'TOKEN_OVERFLOW' ? 413 : 500;
    debugFlow.timing = {
      router_ms: latencyRouterMs,
      search_ms: latencySearchMs,
      answer_ms: latencyAnswerMs,
      total_ms: latencyTotalMs,
    };
    debugFlow.final = {
      response_status: mappedStatus,
      error: message,
    };
    emitFlow('timing', debugFlow.timing);
    emitFlow('final_error', debugFlow.final);

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
      debug_flow: debugFlow,
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
