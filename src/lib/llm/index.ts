/* ------------------------------------------------------------------ */
/*  LLM provider facade — used by app + eval runner                   */
/*                                                                    */
/*  Exports:                                                          */
/*    callAnthropic  — low-level API call                             */
/*    generateText   — text generation with history + retry           */
/*    generateJSON   — JSON generation with safeParseJson + retry     */
/*    withRetry      — exponential backoff for transient errors       */
/*    safeParseJson  — robust JSON extraction from LLM output         */
/*    rateLimit      — global rate limiter                            */
/* ------------------------------------------------------------------ */

export { rateLimit, getMinDelayMs, resetLimiter } from './limiter';
export { callAnthropic, type LLMMessage, type CallAnthropicOptions } from './anthropic';

import { callAnthropic, type LLMMessage } from './anthropic';

/* ================================================================== */
/*  Safe JSON parsing                                                 */
/* ================================================================== */

export interface SafeParseResult {
  ok: boolean;
  data?: Record<string, unknown>;
  error?: string;
}

/**
 * Robustly parse LLM output as JSON.
 * 1. Handles null/empty input.
 * 2. Strips markdown code fences.
 * 3. Tries JSON.parse directly.
 * 4. Falls back to extracting first { … } or [ … ] substring.
 */
export function safeParseJson(raw: string | null | undefined): SafeParseResult {
  if (!raw || raw.trim().length === 0) {
    return { ok: false, error: 'Empty or null input' };
  }

  let cleaned = raw.trim();
  cleaned = cleaned
    .replace(/^```(?:json)?\s*\n?/i, '')
    .replace(/\n?\s*```\s*$/i, '');
  cleaned = cleaned.trim();

  // Attempt 1: direct parse
  try {
    const parsed = JSON.parse(cleaned);
    if (typeof parsed === 'object' && parsed !== null) {
      return { ok: true, data: parsed };
    }
    return { ok: false, error: `Parsed to non-object type: ${typeof parsed}` };
  } catch {
    // fall through
  }

  // Attempt 2: extract first { … }
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    try {
      const substr = cleaned.slice(firstBrace, lastBrace + 1);
      const parsed = JSON.parse(substr);
      if (typeof parsed === 'object' && parsed !== null) {
        return { ok: true, data: parsed };
      }
    } catch {
      // fall through
    }
  }

  // Attempt 3: extract first [ … ]
  const firstBracket = cleaned.indexOf('[');
  const lastBracket = cleaned.lastIndexOf(']');
  if (firstBracket !== -1 && lastBracket > firstBracket) {
    try {
      const substr = cleaned.slice(firstBracket, lastBracket + 1);
      const parsed = JSON.parse(substr);
      if (typeof parsed === 'object' && parsed !== null) {
        return { ok: true, data: parsed as Record<string, unknown> };
      }
    } catch {
      // fall through
    }
  }

  return {
    ok: false,
    error: `Could not extract JSON from: ${cleaned.slice(0, 120)}…`,
  };
}

/* ================================================================== */
/*  withRetry — shared exponential backoff for transient errors       */
/* ================================================================== */

export interface RetryOpts {
  label: string;
  maxAttempts?: number; // default 3
  baseDelayMs?: number; // default 2000
  backoffMultiplier?: number; // default 2
}

const TRANSIENT_PATTERNS = [
  '429',
  '503',
  '529',
  'rate_limit',
  'overloaded',
  'service unavailable',
  'ETIMEDOUT',
  'ECONNRESET',
  'ECONNREFUSED',
  'ENOTFOUND',
  'socket hang up',
  'fetch failed',
];

export function isTransientError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  const lower = msg.toLowerCase();
  return TRANSIENT_PATTERNS.some((p) => lower.includes(p.toLowerCase()));
}

/**
 * Retry `fn` on transient errors with exponential backoff.
 * Default: 2 s → 4 s → 8 s  (3 attempts).
 * Non-transient errors throw immediately.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOpts
): Promise<T> {
  const maxAttempts = opts.maxAttempts ?? 3;
  const baseDelay = opts.baseDelayMs ?? 2000;
  const multiplier = opts.backoffMultiplier ?? 2;

  let lastErr: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err: unknown) {
      lastErr = err;

      if (!isTransientError(err) || attempt === maxAttempts) {
        throw err;
      }

      const delayMs = baseDelay * Math.pow(multiplier, attempt - 1);
      const msg = err instanceof Error ? err.message : String(err);

      // Parse retry-after hint from error
      const retryMatch =
        msg.match(/retry-after:\s*(\d+)/i) ??
        msg.match(/retry\s+(?:after\s+)?(\d+)\s*s/i);
      const actualDelay = retryMatch
        ? Math.max(parseInt(retryMatch[1], 10) * 1000, delayMs)
        : delayMs;

      console.warn(
        `  [retry] ${opts.label} — attempt ${attempt}/${maxAttempts} failed ` +
          `(${msg.slice(0, 80)}), waiting ${(actualDelay / 1000).toFixed(0)}s…`
      );
      await new Promise((r) => setTimeout(r, actualDelay));
    }
  }

  throw lastErr;
}

/* ================================================================== */
/*  High-level helpers                                                */
/* ================================================================== */

export interface GenerateTextOpts {
  model?: string;
  system: string;
  user: string;
  maxTokens?: number;
  temperature?: number;
  history?: LLMMessage[];
}

/**
 * Generate text from the LLM.
 * Rate-limited (via callAnthropic) and retried on transient errors.
 */
export async function generateText(opts: GenerateTextOpts): Promise<string> {
  const messages: LLMMessage[] = [];

  // Add chat history — normalise to strict alternation
  if (opts.history && opts.history.length > 0) {
    let lastRole: string | null = null;
    for (const m of opts.history) {
      if (m.role === lastRole && messages.length > 0) {
        // Merge consecutive same-role messages
        messages[messages.length - 1].content += '\n\n' + m.content;
      } else {
        messages.push({ role: m.role, content: m.content });
        lastRole = m.role;
      }
    }
    // Anthropic requires first message to be user
    if (messages.length > 0 && messages[0].role !== 'user') {
      messages.unshift({ role: 'user', content: '(conversation start)' });
    }
  }

  // Append current user message
  const last = messages[messages.length - 1];
  if (last && last.role === 'user') {
    // Merge with existing user message to avoid consecutive user messages
    last.content += '\n\n' + opts.user;
  } else {
    messages.push({ role: 'user', content: opts.user });
  }

  return withRetry(
    () =>
      callAnthropic({
        model: opts.model,
        system: opts.system,
        messages,
        maxTokens: opts.maxTokens,
        temperature: opts.temperature,
      }),
    { label: 'generateText' }
  );
}

export interface GenerateJSONResult {
  ok: boolean;
  data?: Record<string, unknown>;
  raw: string;
  error?: string;
}

/**
 * Generate JSON from the LLM.
 * Adds JSON-only instruction to system prompt.
 * Parses with safeParseJson; retries once with stricter prompt on parse failure.
 */
export async function generateJSON(
  opts: GenerateTextOpts
): Promise<GenerateJSONResult> {
  const jsonSystem =
    opts.system +
    '\n\nYou MUST respond with ONLY valid JSON. No markdown, no prose, no code fences.';

  const raw = await withRetry(
    () =>
      callAnthropic({
        model: opts.model,
        system: jsonSystem,
        messages: [{ role: 'user', content: opts.user }],
        maxTokens: opts.maxTokens,
        temperature: opts.temperature,
      }),
    { label: 'generateJSON' }
  );

  const parsed = safeParseJson(raw);
  if (parsed.ok) {
    return { ok: true, data: parsed.data, raw };
  }

  // Retry with stricter system prompt
  const strictSystem =
    opts.system +
    '\n\nCRITICAL: Return ONLY valid minified JSON. No markdown. No prose. No code fences. No explanation. Just a single JSON object.';

  const retryRaw = await withRetry(
    () =>
      callAnthropic({
        model: opts.model,
        system: strictSystem,
        messages: [{ role: 'user', content: opts.user }],
        maxTokens: opts.maxTokens,
        temperature: opts.temperature,
      }),
    { label: 'generateJSON-strict' }
  );

  const retryParsed = safeParseJson(retryRaw);
  if (retryParsed.ok) {
    return { ok: true, data: retryParsed.data, raw: retryRaw };
  }

  return {
    ok: false,
    raw: raw + '\n---RETRY---\n' + retryRaw,
    error: `Parse failed: ${parsed.error}; retry: ${retryParsed.error}`,
  };
}
