/* ------------------------------------------------------------------ */
/*  Gemini API integration — grounded tutor with optional web context */
/* ------------------------------------------------------------------ */

import { GoogleGenerativeAI } from '@google/generative-ai';
import { getGeminiApiKey } from './env';
import { ChatMessage } from '@/types';

/* ---------- System prompt ---------- */

const SYSTEM_PROMPT = `You are a helpful tutor that helps users understand news articles.

## Primary Response Policy

1. ALWAYS start by answering from the provided article text.
   Reference specific parts when relevant (e.g. "The article mentions that…").

2. If the article contains sufficient information to fully answer the question,
   answer entirely from it.

3. If the article does NOT contain sufficient information AND web search results
   are provided below the article:
   - First provide what the article says under a heading "**From the article:**"
   - Then provide additional context under a heading "**Additional context:**"
   - Cite every piece of external information with its source like this:
     [Source Name](URL)
   - ONLY use information from the provided search results — never fabricate sources or URLs.

4. If the question needs background but NO search results are provided:
   - Answer from the article as best you can.
   - You may provide brief, commonly-known factual background and label it as:
     "**General background (no web lookup performed):**"
   - Keep general background minimal and clearly separated.
   - Suggest: "For more detailed context with sources, you can retry your question."

## Source Quality Rules (when using search results)
- Prefer official / primary sources (government sites, regulators, committee pages).
- For politics/economics, prioritize: gov.uk, parliament.uk, Reuters, AP, BBC, FT, WSJ, Economist.
- Wikipedia is acceptable only for basic definitions.
- Never cite unreliable or unrecognised sources.

## General Rules
- Never fabricate quotes, numbers, statistics, or claims.
- Be concise by default. Only give detailed explanations when the user explicitly asks for depth.
- If you cannot answer a question even with the provided sources, say so honestly.`;

const MAX_ARTICLE_CHARS = 15_000;
const TIMEOUT_MS = 30_000; // 30-second timeout for Gemini responses

/* ---------- Main function ---------- */

export async function generateChatResponse(
  articleText: string,
  chatHistory: ChatMessage[],
  userMessage: string,
  /** Pre-formatted search results block, or empty string if none. */
  searchContext: string = ''
): Promise<string> {
  const apiKey = getGeminiApiKey();
  const genAI = new GoogleGenerativeAI(apiKey);

  const truncatedArticle =
    articleText.length > MAX_ARTICLE_CHARS
      ? articleText.slice(0, MAX_ARTICLE_CHARS) + '\n\n[Article truncated for length]'
      : articleText;

  // Build the full system instruction: prompt + article + optional search results
  let systemInstruction = `${SYSTEM_PROMPT}\n\n=== ARTICLE TEXT ===\n\n${truncatedArticle}`;

  if (searchContext) {
    systemInstruction += `\n\n${searchContext}`;
  }

  const model = genAI.getGenerativeModel({
    model: 'gemini-2.5-flash-lite',
    systemInstruction,
  });

  // Build chat history in the format Gemini expects (alternating user/model)
  const history = chatHistory.map((msg) => ({
    role: msg.role === 'user' ? ('user' as const) : ('model' as const),
    parts: [{ text: msg.content }],
  }));

  const chat = model.startChat({ history });

  // Race against timeout
  const resultPromise = chat.sendMessage(userMessage);
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('LLM_TIMEOUT')), TIMEOUT_MS)
  );

  try {
    const result = await Promise.race([resultPromise, timeoutPromise]);
    return result.response.text();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    if (message === 'LLM_TIMEOUT') {
      throw new Error('LLM_TIMEOUT');
    }
    if (message.includes('quota') || message.includes('429')) {
      throw new Error('QUOTA_EXCEEDED');
    }
    if (
      message.includes('token') ||
      message.includes('context length') ||
      message.includes('too long')
    ) {
      throw new Error('TOKEN_OVERFLOW');
    }

    throw err;
  }
}
