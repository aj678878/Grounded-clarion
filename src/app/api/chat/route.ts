/* ------------------------------------------------------------------ */
/*  POST /api/chat — Gemini-powered grounded Q&A                     */
/* ------------------------------------------------------------------ */

import { NextRequest, NextResponse } from 'next/server';
import { generateChatResponse } from '@/lib/gemini';
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

    const assistantMessage = await generateChatResponse(
      body.articleText,
      body.chatHistory.map((m) => ({
        role: m.role === 'user' ? 'user' : 'assistant',
        content: String(m.content ?? ''),
      })),
      body.userMessage
    );

    return NextResponse.json({ assistantMessage });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Chat request failed';

    if (message === 'LLM_TIMEOUT') {
      return NextResponse.json(
        { error: 'LLM_TIMEOUT' },
        { status: 504 }
      );
    }
    if (message === 'QUOTA_EXCEEDED') {
      return NextResponse.json(
        { error: 'QUOTA_EXCEEDED' },
        { status: 429 }
      );
    }
    if (message === 'TOKEN_OVERFLOW') {
      return NextResponse.json(
        { error: 'TOKEN_OVERFLOW' },
        { status: 413 }
      );
    }

    console.error('[/api/chat] Error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
