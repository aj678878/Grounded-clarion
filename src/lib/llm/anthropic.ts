/* ------------------------------------------------------------------ */
/*  Anthropic Messages API client (fetch-based, no SDK dependency)    */
/*                                                                    */
/*  Automatically enforces global rate limit before each call.        */
/*  Throws on HTTP errors — callers should wrap in withRetry.         */
/* ------------------------------------------------------------------ */

import { rateLimit } from './limiter';
import { MODELS } from '../config';

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

/* ---------- Types ---------- */

export interface LLMMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface CallAnthropicOptions {
  model?: string;
  system?: string;
  messages: LLMMessage[];
  maxTokens?: number;
  temperature?: number;
  applyRateLimit?: boolean;
}

/* ---------- Client ---------- */

/**
 * Call the Anthropic Messages API.
 *
 * - Reads ANTHROPIC_API_KEY from process.env at call time (lazy).
 * - Optionally enforces the global rate limit before each request.
 * - Returns the assistant's text response.
 * - Throws on HTTP errors (include status + body for retry logic).
 */
export async function callAnthropic(opts: CallAnthropicOptions): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');

  const model = opts.model ?? MODELS.tutor;

  // ---- Rate-limit gate ----
  if (opts.applyRateLimit) {
    await rateLimit();
  }

  // ---- Build request body ----
  const body: Record<string, unknown> = {
    model,
    max_tokens: opts.maxTokens ?? 1024,
    messages: opts.messages,
  };

  if (opts.system) body.system = opts.system;
  if (opts.temperature !== undefined) body.temperature = opts.temperature;

  // ---- HTTP call ----
  const res = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    const retryAfter = res.headers.get('retry-after');
    let msg = `Anthropic ${res.status}: ${errBody.slice(0, 300)}`;
    if (retryAfter) msg += ` (retry-after: ${retryAfter}s)`;
    throw new Error(msg);
  }

  // ---- Extract text from response ----
  const data = (await res.json()) as {
    content?: Array<{ type: string; text?: string }>;
  };

  const parts = (data.content ?? [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text ?? '');

  return parts.join('');
}
