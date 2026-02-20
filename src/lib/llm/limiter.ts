/* ------------------------------------------------------------------ */
/*  Global LLM rate limiter — minimum interval between API calls      */
/*                                                                    */
/*  Anthropic free tier: 5 RPM.                                       */
/*  Default: 13 000 ms between calls → safely under 5 RPM.           */
/*  Configure via LLM_MIN_DELAY_MS env var.                           */
/* ------------------------------------------------------------------ */

let lastCallTime = 0;

/**
 * Enforce minimum delay between LLM API calls.
 * Called automatically inside `callAnthropic` — no need to call manually.
 */
export async function rateLimit(): Promise<void> {
  const minDelay = parseInt(process.env.LLM_MIN_DELAY_MS ?? '13000', 10);
  const now = Date.now();
  const elapsed = now - lastCallTime;

  if (lastCallTime > 0 && elapsed < minDelay) {
    const waitMs = minDelay - elapsed;
    console.log(`  [limiter] Waiting ${(waitMs / 1000).toFixed(1)}s for rate limit…`);
    await new Promise((r) => setTimeout(r, waitMs));
  }

  lastCallTime = Date.now();
}

/** Get the configured minimum delay. */
export function getMinDelayMs(): number {
  return parseInt(process.env.LLM_MIN_DELAY_MS ?? '13000', 10);
}

/** Reset limiter state (for testing). */
export function resetLimiter(): void {
  lastCallTime = 0;
}
