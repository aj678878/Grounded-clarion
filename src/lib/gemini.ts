/* ------------------------------------------------------------------ */
/*  LLM integration — sufficiency router + grounded tutor response    */
/*                                                                    */
/*  Backed by Anthropic (Claude) via the shared LLM provider.         */
/*  File kept as gemini.ts to avoid renaming all imports.             */
/* ------------------------------------------------------------------ */

import { generateText, generateJSON } from '@/lib/llm';
import { ChatMessage } from '@/types';

/* ================================================================== */
/*  Step A — Sufficiency Router                                       */
/* ================================================================== */

const ROUTER_PROMPT = `You are a routing assistant for a news Q&A system.

Your task: decide whether the ARTICLE EXCERPT alone contains enough information to answer the user's question accurately and completely.

You are NOT deciding whether web search would improve the answer.
You are deciding whether web search is REQUIRED.

Output ONLY valid JSON with this exact schema:
{
  "need_web": boolean,
  "reason": string,
  "suggested_queries": string[],
  "must_cite": boolean
}

Decision Rules:

Set need_web = true ONLY if:
- The question requires factual information that is NOT present in the article excerpt.
- The user asks for:
    • Definitions of entities not explained in the article
    • Background history not described
    • Legal/regulatory details not mentioned
    • Current status beyond the article's timeframe
    • Quantitative data not included in the excerpt
- The answer would require introducing NEW factual claims not grounded in the article.
- The question asks for comparison to past events, prior occurrences, or historical reference points not explicitly described in the article.

Set need_web = false if:
- The article excerpt contains enough information to answer through reasoning, explanation, or synthesis.
- The user asks about implications, significance, risks, impacts, incentives, or interpretation that can be logically derived from the article.
- The question is analytical rather than factual.

Important:
- Do NOT trigger web search just because additional context might exist.
- Only trigger if the answer would require adding facts not in the excerpt.

must_cite:
- true ONLY if need_web = true.
- false otherwise.

suggested_queries:
- Only provide 1–2 short factual queries if need_web = true.
- Leave empty array if need_web = false.
- Queries must be high-precision and directly target the missing facts.
- Do NOT append filler words such as "authoritative source", "cite", "grounded", or instruction-like phrases.
- Prefer the structure: "<entity/topic> <missing fact> <timeframe/location>".
- Avoid long concatenated queries or mixing in the article headline.

reason:
- One short sentence explaining why the article is or is not sufficient.

Do NOT output anything except the JSON object.
`;

export interface SufficiencyResult {
  need_web: boolean;
  reason: string;
  suggested_queries: string[];
  must_cite: boolean;
}

export interface SufficiencyDebugInfo {
  article_excerpt_used: string;
  recent_history_used: string;
  user_prompt: string;
  model: string;
  max_tokens: number;
  raw_output: string;
  parse_ok: boolean;
  parse_error: string;
  used_default: boolean;
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
  const out = await checkSufficiencyWithDebug(articleText, userMessage, chatHistory);
  return out.result;
}

export async function checkSufficiencyWithDebug(
  articleText: string,
  userMessage: string,
  chatHistory: ChatMessage[]
): Promise<{ result: SufficiencyResult; debug: SufficiencyDebugInfo }> {
  const condensed =
    articleText.length > 3_000
      ? articleText.slice(0, 3_000) + '\n…[article truncated for routing]'
      : articleText;

  const recentHistory = chatHistory
    .slice(-2)
    .map((m) => `${m.role}: ${m.content}`)
    .join('\n');

  const userPrompt = [
    recentHistory ? `Recent conversation:\n${recentHistory}\n` : '',
    `Article (condensed):\n${condensed}\n`,
    `User question: ${userMessage}`,
  ]
    .filter(Boolean)
    .join('\n');

  const model = process.env.MODEL_ROUTER ?? 'claude-3-haiku-20240307';
  const maxTokens = 200;

  const baseDebug: SufficiencyDebugInfo = {
    article_excerpt_used: condensed,
    recent_history_used: recentHistory,
    user_prompt: userPrompt,
    model,
    max_tokens: maxTokens,
    raw_output: '',
    parse_ok: false,
    parse_error: '',
    used_default: false,
  };

  try {
    const result = await generateJSON({
      model,
      system: ROUTER_PROMPT,
      user: userPrompt,
      maxTokens,
    });

    const debug: SufficiencyDebugInfo = {
      ...baseDebug,
      raw_output: result.raw,
      parse_ok: result.ok,
      parse_error: result.error ?? '',
      used_default: false,
    };

    if (!result.ok || !result.data) {
      console.warn('[router] JSON parse failed:', result.error);
      debug.used_default = true;
      return { result: DEFAULT_RESULT, debug };
    }

    const parsed = result.data;
    if (typeof parsed.need_web !== 'boolean') {
      debug.used_default = true;
      debug.parse_error = debug.parse_error || 'need_web missing/invalid';
      return { result: DEFAULT_RESULT, debug };
    }

    return {
      result: {
        need_web: parsed.need_web,
        reason: typeof parsed.reason === 'string' ? parsed.reason : '',
        suggested_queries: Array.isArray(parsed.suggested_queries)
          ? (parsed.suggested_queries as string[])
          : [],
        must_cite: typeof parsed.must_cite === 'boolean' ? parsed.must_cite : false,
      },
      debug,
    };
  } catch (err) {
    console.error('[router] Sufficiency check failed:', err);
    return {
      result: DEFAULT_RESULT,
      debug: {
        ...baseDebug,
        parse_error: err instanceof Error ? err.message : String(err),
        used_default: true,
      },
    };
  }
}

export interface GenerateChatDebugInfo {
  model: string;
  max_output_tokens: number;
  article_was_truncated: boolean;
  article_chars_in: number;
  article_chars_used: number;
  strict_sources_instruction_added: boolean;
  system_prompt_sent: string;
  history_sent: Array<{ role: 'user' | 'assistant'; content: string }>;
  user_message_sent: string;
  raw_model_output: string;
  postprocess: {
    used_search_context: boolean;
    stripped_numeric_markers: boolean;
    sources_near_end_before: boolean;
    parsed_sources_from_context: { title: string; url: string }[];
    appended_deterministic_sources: boolean;
    returned_incomplete_fallback: boolean;
  };
}

export async function generateChatResponseWithDebug(
  articleText: string,
  chatHistory: ChatMessage[],
  userMessage: string,
  searchContext: string = ''
): Promise<{ answer: string; debug: GenerateChatDebugInfo }> {
  const truncatedArticle =
    articleText.length > MAX_ARTICLE_CHARS
      ? articleText.slice(0, MAX_ARTICLE_CHARS) + '\n\n[Article truncated for length]'
      : articleText;

  let system = `${SYSTEM_PROMPT}\n\n=== ARTICLE TEXT ===\n\n${truncatedArticle}`;
  if (searchContext) {
    system += `\n\n${searchContext}`;
    system += STRICT_SOURCES_INSTRUCTION;
  }

  const model = process.env.MODEL_TUTOR ?? 'claude-3-haiku-20240307';
  const history = chatHistory.map((msg) => ({
    role: msg.role as 'user' | 'assistant',
    content: msg.content,
  }));

  const debugBase: Omit<GenerateChatDebugInfo, 'raw_model_output' | 'postprocess'> = {
    model,
    max_output_tokens: MAX_OUTPUT_TOKENS,
    article_was_truncated: articleText.length > MAX_ARTICLE_CHARS,
    article_chars_in: articleText.length,
    article_chars_used: truncatedArticle.length,
    strict_sources_instruction_added: Boolean(searchContext),
    system_prompt_sent: system,
    history_sent: history,
    user_message_sent: userMessage,
  };

  try {
    const raw = await generateText({
      model,
      system,
      user: userMessage,
      maxTokens: MAX_OUTPUT_TOKENS,
      history,
    });

    if (!raw || raw.trim().length < 10) {
      return {
        answer: 'The response appears incomplete. Please retry your question.',
        debug: {
          ...debugBase,
          raw_model_output: raw ?? '',
          postprocess: {
            used_search_context: Boolean(searchContext),
            stripped_numeric_markers: false,
            sources_near_end_before: false,
            parsed_sources_from_context: [],
            appended_deterministic_sources: false,
            returned_incomplete_fallback: true,
          },
        },
      };
    }

    let text = raw;
    let strippedNumeric = false;
    let sourcesNearEndBefore = false;
    let appendedDeterministicSources = false;
    let parsedSources: { title: string; url: string }[] = [];

    if (searchContext) {
      const stripped = stripNumericMarkers(text);
      strippedNumeric = stripped !== text;
      text = stripped;
      sourcesNearEndBefore = hasSourcesSectionNearEnd(text);
      if (!sourcesNearEndBefore) {
        parsedSources = parseSourcesFromContext(searchContext);
        if (parsedSources.length > 0) {
          text += buildMarkdownSources(parsedSources);
          appendedDeterministicSources = true;
        }
      }
    }

    return {
      answer: text,
      debug: {
        ...debugBase,
        raw_model_output: raw,
        postprocess: {
          used_search_context: Boolean(searchContext),
          stripped_numeric_markers: strippedNumeric,
          sources_near_end_before: sourcesNearEndBefore,
          parsed_sources_from_context: parsedSources,
          appended_deterministic_sources: appendedDeterministicSources,
          returned_incomplete_fallback: false,
        },
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    if (message.includes('timeout') || message.includes('TIMEOUT')) {
      throw new Error('LLM_TIMEOUT');
    }
    if (
      message.includes('429') ||
      message.includes('rate_limit') ||
      message.includes('quota')
    ) {
      throw new Error('QUOTA_EXCEEDED');
    }
    if (message.includes('token') || message.includes('too long')) {
      throw new Error('TOKEN_OVERFLOW');
    }

    throw err;
  }
}

export async function generateChatResponse(
  articleText: string,
  chatHistory: ChatMessage[],
  userMessage: string,
  searchContext: string = ''
): Promise<string> {
  const out = await generateChatResponseWithDebug(
    articleText,
    chatHistory,
    userMessage,
    searchContext
  );
  return out.answer;
}

/* ================================================================== */
/*  Step B — Response Generation                                      */
/* ================================================================== */

const SYSTEM_PROMPT = `You are a helpful tutor that explains news articles to curious readers.

## How to write (readability-first)

- If the user asks multiple questions, answer them in the same order they were asked.
- Use short paragraphs (roughly 3 lines max). Insert a blank line between distinct ideas.
- Use **bold** sparingly — only for genuinely key terms or names on first mention.
- Do NOT force bullet points, numbered lists, or section headers unless they genuinely help.
- Write in natural flowing prose. A conversational, clear tone is preferred over rigid structure.
- Always finish with a complete sentence — never stop mid-word or mid-thought.
- Be concise by default. Expand only when the user asks for depth.

## Grounding rules

1. Use the ARTICLE TEXT first. If the article covers the question, answer from it.
2. When WEB CONTEXT is provided, use it for missing background, definitions, or facts. ONLY use information from the provided web context — do not introduce other external information.
3. Never fabricate quotes, numbers, statistics, claims, sources, or URLs.
4. If the article is insufficient and no web context is provided, say so honestly.
5. If sources conflict, state both viewpoints and cite each.`;

const MAX_ARTICLE_CHARS = 10_000;
const MAX_OUTPUT_TOKENS = 900;

const STRICT_SOURCES_INSTRUCTION = `

STRICT REQUIREMENT — because web search was performed:

Your answer MUST end with a **Sources:** section formatted exactly like this:

**Sources:**
1. [Source Title](https://actual-url.com)
2. [Source Title](https://actual-url.com)

When WEB CONTEXT is provided:

- Your explanation must include specific factual details from the provided web context that directly help answer the user’s question.
- Do not provide vague commentary or speculation if concrete information is available.
- Do not state that the article lacks sufficient detail if the web context contains relevant information.
- Integrate facts naturally into the explanation, not just in the Sources section.

Rules:
- Use markdown link syntax: [Title](URL). This is mandatory.
- Include ONLY sources you actually used from the provided web results.
- Put the Sources section at the VERY END of the answer (last lines).
- Do NOT use [1], [2], [3] or any numeric reference markers anywhere in the answer body.
- Do NOT cite Quora/Facebook/Reddit unless no other sources exist.`;

/* ---- Deterministic post-processing helpers ---- */

/** Parse title+url pairs from the formatted searchContext string. */
function parseSourcesFromContext(ctx: string): { title: string; url: string }[] {
  const sources: { title: string; url: string }[] = [];
  // Matches: [1] "Title" — domain  OR  [1] Title — domain
  const titlePattern = /\[\d+\]\s*"?([^"—\n]+)"?\s*—/g;
  const urlPattern = /URL:\s*(https?:\/\/\S+)/g;

  const titles: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = titlePattern.exec(ctx)) !== null) titles.push(m[1].trim());

  const urls: string[] = [];
  while ((m = urlPattern.exec(ctx)) !== null) urls.push(m[1]);

  for (let i = 0; i < Math.min(titles.length, urls.length, 5); i++) {
    sources.push({ title: titles[i], url: urls[i] });
  }
  return sources;
}

/** Check if answer has a Sources header near the end (last 30%) with at least one URL. */
function hasSourcesSectionNearEnd(text: string): boolean {
  const headerPattern = /(?:^|\n)\s*\**(?:Sources|Source|References)\**\s*:?/gi;
  let lastIdx = -1;
  let m: RegExpExecArray | null;
  while ((m = headerPattern.exec(text)) !== null) lastIdx = m.index;
  if (lastIdx < 0 || lastIdx < text.length * 0.7) return false;
  return /https?:\/\/\S+/.test(text.slice(lastIdx));
}

/** Build a markdown-link Sources section from parsed Tavily results. */
function buildMarkdownSources(sources: { title: string; url: string }[]): string {
  if (sources.length === 0) return '';
  const lines = sources.map((s, i) => `${i + 1}. [${s.title}](${s.url})`);
  return `\n\n**Sources:**\n${lines.join('\n')}`;
}

/** Strip numeric bracket markers like [1], [2], [3] from text. */
function stripNumericMarkers(text: string): string {
  return text.replace(/\[\d+\]/g, '');
}

/* ================================================================== */
/*  Sources repair — called from route when validation fails          */
/* ================================================================== */

export async function repairSourcesInAnswer(
  answer: string,
  searchContext: string
): Promise<string> {
  const model = process.env.MODEL_TUTOR ?? 'claude-3-haiku-20240307';

  const repairSystem = `You are a text editor. Your ONLY job is to:
1. Remove any [1], [2], [3] numeric reference markers from the answer body.
2. Add a proper **Sources:** section at the end with URLs from the provided web search results.
Do NOT change the substantive content of the answer.`;

  const repairUser = `Here is the answer that needs a Sources section added at the end:

---
${answer}
---

Here are the web search results that were available:

${searchContext}

TASK: Return the COMPLETE original answer with these fixes:
1. Remove any [1], [2], [3] numeric reference markers from the body text.
2. Append a proper "**Sources:**" section at the very end. Each source entry must include: number, title, and full URL.
Only include sources that were referenced in the answer. If unclear which were used, include the top 2 most relevant.

Return ONLY the full corrected answer text — nothing else.`;

  try {
    const repaired = await generateText({
      model,
      system: repairSystem,
      user: repairUser,
      maxTokens: MAX_OUTPUT_TOKENS + 200,
    });
    return repaired || answer;
  } catch {
    return answer;
  }
}
