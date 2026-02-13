/* ------------------------------------------------------------------ */
/*  POST /api/chat — Two-step autonomous tool-use routing             */
/*                                                                    */
/*  Step A: Sufficiency router (Gemini, ~150 tokens, ≤5 s)            */
/*          → decides if web search is needed + suggests queries      */
/*  Step B: If need_web → Tavily search (≤8 s, max 2 queries, 3 src) */
/*  Step C: Response generation (Gemini, article ± search context)    */
/*                                                                    */
/*  Guarantees per user message:                                      */
/*    - Exactly 2 Gemini calls (1 router + 1 response)                */
/*    - At most 1 Tavily search (0 if article is sufficient)          */
/*    - No duplicate calls from React Strict Mode (user-initiated)    */
/* ------------------------------------------------------------------ */

import { NextRequest, NextResponse } from 'next/server';
import { checkSufficiency, generateChatResponse } from '@/lib/gemini';
import { searchTavily, isSearchAvailable, formatSearchResultsForLLM } from '@/lib/search';
import { ChatRequest } from '@/types';

export async function POST(request: NextRequest) {
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

    const sanitizedHistory = body.chatHistory.map((m) => ({
      role: m.role === 'user' ? ('user' as const) : ('assistant' as const),
      content: String(m.content ?? ''),
    }));

    // ---- Step A: Sufficiency router ----
    let searchContext = '';
    let searchTimedOut = false;

    if (isSearchAvailable()) {
      const routing = await checkSufficiency(
        body.articleText,
        body.userMessage,
        sanitizedHistory
      );

      console.log('[chat] Router decision:', {
        need_web: routing.need_web,
        reason: routing.reason,
        queries: routing.suggested_queries,
      });

      // ---- Step B: Tavily search (if needed) ----
      if (routing.need_web && routing.suggested_queries.length > 0) {
        const { results, timedOut } = await searchTavily(routing.suggested_queries);
        searchTimedOut = timedOut;

        if (results.length > 0) {
          searchContext = formatSearchResultsForLLM(results);
        }
      }
    }

    // ---- Step C: Generate response ----
    let assistantMessage = await generateChatResponse(
      body.articleText,
      sanitizedHistory,
      body.userMessage,
      searchContext
    );

    // Append timeout note if search failed
    if (searchTimedOut) {
      assistantMessage +=
        '\n\n---\n_I couldn\'t fetch reliable external context right now. The answer above is based on the article only. You can retry for additional sourced context._';
    }

    return NextResponse.json({ assistantMessage });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Chat request failed';

    if (message === 'LLM_TIMEOUT') {
      return NextResponse.json({ error: 'LLM_TIMEOUT' }, { status: 504 });
    }
    if (message === 'QUOTA_EXCEEDED') {
      return NextResponse.json({ error: 'QUOTA_EXCEEDED' }, { status: 429 });
    }
    if (message === 'TOKEN_OVERFLOW') {
      return NextResponse.json({ error: 'TOKEN_OVERFLOW' }, { status: 413 });
    }

    console.error('[/api/chat] Error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
