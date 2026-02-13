/* ------------------------------------------------------------------ */
/*  POST /api/chat — Gemini-powered grounded Q&A with optional web    */
/*  search for additional context.                                    */
/*                                                                    */
/*  Flow per request:                                                 */
/*    1. Validate inputs                                              */
/*    2. Check if the question likely needs external context           */
/*    3. If yes → web search (max 8 s timeout)                        */
/*    4. Call Gemini with article + optional search results            */
/*    5. Return assistantMessage                                      */
/*                                                                    */
/*  Guarantees: exactly 1 Gemini call, at most 1 search call.         */
/* ------------------------------------------------------------------ */

import { NextRequest, NextResponse } from 'next/server';
import { generateChatResponse } from '@/lib/gemini';
import { needsExternalContext, searchWeb, formatSearchResultsForLLM } from '@/lib/search';
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

    // ---- Optional web search for context ----
    let searchContext = '';
    let searchTimedOut = false;

    if (needsExternalContext(body.userMessage)) {
      const { results, searchTimedOut: timedOut } = await searchWeb(body.userMessage);
      searchTimedOut = timedOut;

      if (results.length > 0) {
        searchContext = formatSearchResultsForLLM(results);
      }
    }

    // ---- Call Gemini ----
    let assistantMessage = await generateChatResponse(
      body.articleText,
      body.chatHistory.map((m) => ({
        role: m.role === 'user' ? 'user' : 'assistant',
        content: String(m.content ?? ''),
      })),
      body.userMessage,
      searchContext
    );

    // If search timed out, append a note so the user knows they can retry
    if (searchTimedOut) {
      assistantMessage +=
        '\n\n---\n_Web search timed out. I answered from the article only. Retry for additional context with sources._';
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
