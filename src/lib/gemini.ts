/* ------------------------------------------------------------------ */
/*  Gemini API integration — grounded conversational tutor            */
/* ------------------------------------------------------------------ */

import { GoogleGenerativeAI } from '@google/generative-ai';
import { getGeminiApiKey } from './env';
import { ChatMessage } from '@/types';

const SYSTEM_PROMPT = `You are a helpful tutor that helps users understand news articles. Follow these rules strictly:

1. Ground ALL answers in the provided article text. Reference specific parts when relevant (e.g. "The article mentions that…").
2. Never fabricate quotes, numbers, statistics, or claims not supported by the article.
3. If the user asks for background context beyond the article, clearly label it as "General context:" and tie it back to the article.
4. Be concise by default. Only give detailed explanations when the user explicitly asks for more depth.
5. If you cannot answer a question based on the article, say so honestly rather than guessing.`;

const MAX_ARTICLE_CHARS = 15_000; // truncate very long articles to stay within token limits
const TIMEOUT_MS = 30_000; // 30-second timeout for Gemini responses

export async function generateChatResponse(
  articleText: string,
  chatHistory: ChatMessage[],
  userMessage: string
): Promise<string> {
  const apiKey = getGeminiApiKey();
  const genAI = new GoogleGenerativeAI(apiKey);

  const truncatedArticle =
    articleText.length > MAX_ARTICLE_CHARS
      ? articleText.slice(0, MAX_ARTICLE_CHARS) + '\n\n[Article truncated for length]'
      : articleText;

  const model = genAI.getGenerativeModel({
    model: 'gemini-3-pro-preview',
    systemInstruction: `${SYSTEM_PROMPT}\n\nArticle text:\n\n${truncatedArticle}`,
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
