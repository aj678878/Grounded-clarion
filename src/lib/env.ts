/* ------------------------------------------------------------------ */
/*  Environment variable helpers with clear error messages            */
/* ------------------------------------------------------------------ */

export function getEnvVar(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required environment variable: ${name}. ` +
        'Please check your .env.local file or Vercel project settings.'
    );
  }
  return value;
}

export function getGuardianApiKey(): string {
  return getEnvVar('GUARDIAN_API_KEY');
}

export function getGuardianBaseUrl(): string {
  return process.env.GUARDIAN_API_BASE_URL || 'https://content.guardianapis.com';
}

export function getAnthropicApiKey(): string {
  return getEnvVar('ANTHROPIC_API_KEY');
}

/** @deprecated — kept for backward compatibility; use getAnthropicApiKey(). */
export function getGeminiApiKey(): string {
  // Try Gemini key first for legacy compat, fall back to Anthropic
  const gemini = process.env.GEMINI_API_KEY;
  if (gemini) return gemini;
  return getEnvVar('ANTHROPIC_API_KEY');
}
