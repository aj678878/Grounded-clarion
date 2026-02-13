/* ------------------------------------------------------------------ */
/*  Gemini API — sufficiency router + grounded tutor response         */
/* ------------------------------------------------------------------ */

import { GoogleGenerativeAI } from '@google/generative-ai';
import { getGeminiApiKey } from './env';
import { ChatMessage } from '@/types';

/* ================================================================== */
/*  Step A — Sufficiency Router                                       */
/*  Cheap/fast call to decide if we need web context.                 */
/* ================================================================== */

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

const ROUTER_TIMEOUT_MS = 5_000;

export interface SufficiencyResult {
  need_web: boolean;
  reason: string;
  suggested_queries: string[];
  must_cite: boolean;
}

const DEFAULT_RESULT: SufficiencyResult = {
  need_web: false,
  reason: 'Router defaulted (timeout or error)',
  suggested_queries: [],
  must_cite: false,
};

export async function checkSufficiency(
  articleText: string,
  userMessage: string,
  chatHistory: ChatMessage[]
): Promise<SufficiencyResult> {
  try {
    const apiKey = getGeminiApiKey();
    const genAI = new GoogleGenerativeAI(apiKey);

    // Condense article to save tokens on the router call
    const condensed =
      articleText.length > 3_000
        ? articleText.slice(0, 3_000) + '\n…[article truncated for routing]'
        : articleText;

    // Include last 2 chat messages for conversational context
    const recentHistory = chatHistory
      .slice(-2)
      .map((m) => `${m.role}: ${m.content}`)
      .join('\n');

    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash-lite',
      systemInstruction: ROUTER_PROMPT,
      generationConfig: {
        responseMimeType: 'application/json',
        maxOutputTokens: 200,
      },
    });

    const prompt = [
      recentHistory ? `Recent conversation:\n${recentHistory}\n` : '',
      `Article (condensed):\n${condensed}\n`,
      `User question: ${userMessage}`,
    ]
      .filter(Boolean)
      .join('\n');

    const resultPromise = model.generateContent(prompt);
    const timeoutPromise = new Promise<'TIMEOUT'>((resolve) =>
      setTimeout(() => resolve('TIMEOUT'), ROUTER_TIMEOUT_MS)
    );

    const raceResult = await Promise.race([resultPromise, timeoutPromise]);

    if (raceResult === 'TIMEOUT') {
      console.warn('[router] Sufficiency check timed out');
      return DEFAULT_RESULT;
    }

    const text = raceResult.response.text();
    const parsed = JSON.parse(text) as SufficiencyResult;

    // Validate shape
    if (typeof parsed.need_web !== 'boolean') return DEFAULT_RESULT;
    if (!Array.isArray(parsed.suggested_queries)) parsed.suggested_queries = [];

    return parsed;
  } catch (err) {
    console.error('[router] Sufficiency check failed:', err);
    return DEFAULT_RESULT;
  }
}

/* ================================================================== */
/*  Step B — Response Generation                                      */
/* ================================================================== */

const SYSTEM_PROMPT = `You are a helpful tutor that helps users understand news articles.

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

const MAX_ARTICLE_CHARS = 15_000;
const RESPONSE_TIMEOUT_MS = 30_000;

export async function generateChatResponse(
  articleText: string,
  chatHistory: ChatMessage[],
  userMessage: string,
  searchContext: string = ''
): Promise<string> {
  const apiKey = getGeminiApiKey();
  const genAI = new GoogleGenerativeAI(apiKey);

  const truncatedArticle =
    articleText.length > MAX_ARTICLE_CHARS
      ? articleText.slice(0, MAX_ARTICLE_CHARS) + '\n\n[Article truncated for length]'
      : articleText;

  let systemInstruction = `${SYSTEM_PROMPT}\n\n=== ARTICLE TEXT ===\n\n${truncatedArticle}`;

  if (searchContext) {
    systemInstruction += `\n\n${searchContext}`;
  }

  const model = genAI.getGenerativeModel({
    model: 'gemini-2.5-flash-lite',
    systemInstruction,
  });

  const history = chatHistory.map((msg) => ({
    role: msg.role === 'user' ? ('user' as const) : ('model' as const),
    parts: [{ text: msg.content }],
  }));

  const chat = model.startChat({ history });

  const resultPromise = chat.sendMessage(userMessage);
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('LLM_TIMEOUT')), RESPONSE_TIMEOUT_MS)
  );

  try {
    const result = await Promise.race([resultPromise, timeoutPromise]);
    return result.response.text();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    if (message === 'LLM_TIMEOUT') throw new Error('LLM_TIMEOUT');
    if (message.includes('quota') || message.includes('429')) throw new Error('QUOTA_EXCEEDED');
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
