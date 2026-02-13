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

export function getGeminiApiKey(): string {
  return getEnvVar('GEMINI_API_KEY');
}
