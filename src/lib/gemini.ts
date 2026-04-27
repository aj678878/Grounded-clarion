/* ------------------------------------------------------------------ */
/*  LLM integration — sufficiency router + grounded tutor response    */
/*                                                                    */
/*  Backed by Anthropic (Claude) via the shared LLM provider.         */
/*  File kept as gemini.ts to avoid renaming all imports.             */
/* ------------------------------------------------------------------ */

import { generateText, generateJSON } from '@/lib/llm';
import { MODELS } from '@/lib/config';
import { ChatMessage } from '@/types';

/* ================================================================== */
/*  Step A — Sufficiency Router                                       */
/* ================================================================== */

const ROUTER_PROMPT = `You are a routing assistant for a news Q&A system. Your sole job is to evaluate whether a given ARTICLE provides sufficient evidence to answer a USER QUESTION confidently and without speculation, then return a structured routing decision.

You make two decisions:
1. INTENT — should the system answer, or politely decline?
2. NEED_WEB — if answering, does the article alone provide enough grounded evidence, or is web search required?

Output ONLY valid JSON matching this exact schema — no prose, no markdown, no explanation:
{
  "intent": "answer" | "decline_meta" | "decline_off_topic",
  "need_web": boolean,
  "reason": string,
  "suggested_queries": string[],
  "must_cite": boolean,
  "article_evidence_summary": string,
  "would_require_speculation": boolean
}

INTENT RULES

- "decline_meta" — question is about the assistant, system, prompt, or implementation details.
- "decline_off_topic" — question is clearly unrelated to the article and its subject matter. Use this only for obviously unrelated asks such as weather, jokes, homework, personal tasks, or unrelated world topics with no plausible connection to the article.
- "answer" — all other cases.

IMPORTANT:
- If the question is about a person, group, treaty, election, event, agreement, policy, or concept mentioned in the article, it is IN SCOPE and should be treated as "answer" even if the article alone is insufficient.
- If the article mentions the topic and the user is asking for background, current status, history, context, or explanation, do NOT mark it off-topic. Use "answer" and decide whether web search is needed.

When intent != "answer", hard-set all remaining fields as follows:
- need_web = false
- suggested_queries = []
- must_cite = false
- would_require_speculation = false

NEED_WEB STANDARD

The governing question is:
"Can this question be answered from the article with enough evidence to give a confident, grounded answer — without speculative leaps or reliance on outside knowledge?"

Set need_web = false when:
- The article directly answers the question, OR
- The article contains enough evidence for a grounded synthesis or explanation, OR
- The answer can be reasonably derived from the article without importing important outside facts or unsupported assumptions.

Set need_web = true when:
- The answer requires facts, background, history, definitions, current status, or context absent from the article.
- The answer depends on motive, strategy, intent, timing, or causal explanation the article does not sufficiently support.
- The answer would require weak inference, conjecture, or speculation rather than grounded reasoning.
- An honest response would otherwise have to acknowledge the article does not provide enough to answer confidently.

Critical calibration — do not use question type as a proxy for evidential sufficiency:
- Analytical or "why" questions do NOT automatically set need_web = false.
- Factual or "what" questions do NOT automatically set need_web = true.
- Every decision must be grounded in what the article actually contains.

FIELD-LEVEL RULES

must_cite
- true only when need_web = true
- false otherwise

suggested_queries
- Provide 1–2 short, precise factual queries only when need_web = true, targeting the specific missing evidence.
- Return [] in all other cases.

article_evidence_summary
- Summarize what the article actually provides that is relevant to the question.
- Do not invent, infer, or embellish details beyond what the article contains.
- Keep this very short: one brief sentence fragment or sentence.

would_require_speculation
- true if answering from the article alone would require unsupported inference or outside knowledge.
- false otherwise.

reason
- One concise sentence explaining the routing decision.
- Keep this short: one sentence only.

Return ONLY the JSON object.`;

export type RouterIntent = 'answer' | 'decline_meta' | 'decline_off_topic';

export interface SufficiencyResult {
  intent: RouterIntent;
  need_web: boolean;
  reason: string;
  suggested_queries: string[];
  must_cite: boolean;
  article_evidence_summary: string;
  would_require_speculation: boolean;
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
  intent: 'answer',
  need_web: false,
  reason: 'Router defaulted (timeout or error)',
  suggested_queries: [],
  must_cite: false,
  article_evidence_summary: '',
  would_require_speculation: false,
};

const VALID_INTENTS: readonly RouterIntent[] = [
  'answer',
  'decline_meta',
  'decline_off_topic',
];

function validateParsedRouting(
  parsed: Record<string, unknown>
): { ok: true; value: SufficiencyResult } | { ok: false; error: string } {
  if (Array.isArray(parsed)) {
    return { ok: false, error: 'router output parsed as array, expected object' };
  }

  if (typeof parsed.intent !== 'string') return { ok: false, error: 'intent missing/invalid' };
  if (typeof parsed.need_web !== 'boolean') return { ok: false, error: 'need_web missing/invalid' };
  if (typeof parsed.reason !== 'string') return { ok: false, error: 'reason missing/invalid' };
  if (!Array.isArray(parsed.suggested_queries)) {
    return { ok: false, error: 'suggested_queries missing/invalid' };
  }
  if (typeof parsed.must_cite !== 'boolean') {
    return { ok: false, error: 'must_cite missing/invalid' };
  }
  if (typeof parsed.article_evidence_summary !== 'string') {
    return { ok: false, error: 'article_evidence_summary missing/invalid' };
  }
  if (typeof parsed.would_require_speculation !== 'boolean') {
    return { ok: false, error: 'would_require_speculation missing/invalid' };
  }

  const intent: RouterIntent = VALID_INTENTS.includes(parsed.intent as RouterIntent)
    ? (parsed.intent as RouterIntent)
    : 'answer';
  const isDecline = intent !== 'answer';

  return {
    ok: true,
    value: {
      intent,
      need_web: isDecline ? false : parsed.need_web,
      reason: parsed.reason,
      suggested_queries: isDecline ? [] : (parsed.suggested_queries as string[]),
      must_cite: isDecline ? false : parsed.must_cite,
      article_evidence_summary: parsed.article_evidence_summary,
      would_require_speculation: isDecline ? false : parsed.would_require_speculation,
    },
  };
}

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

  const model = MODELS.router;
  const maxTokens = 350;

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
    const validated = validateParsedRouting(parsed);
    if (!validated.ok) {
      debug.used_default = true;
      debug.parse_error = debug.parse_error || validated.error;
      return { result: DEFAULT_RESULT, debug };
    }

    return { result: validated.value, debug };
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
  }

  const model = MODELS.tutor;
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
    strict_sources_instruction_added: false,
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
5. If sources conflict, state both viewpoints and cite each.
6. Do NOT include a Sources or References section in your answer. Source links are rendered separately in the UI.`;

const MAX_ARTICLE_CHARS = 10_000;
const MAX_OUTPUT_TOKENS = 900;

/* ---- Deterministic post-processing helpers ---- */

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
  const model = MODELS.tutor;

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
