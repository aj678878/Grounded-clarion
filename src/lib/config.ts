/* ------------------------------------------------------------------ */
/*  Centralized runtime config — single source of truth for models.   */
/*                                                                    */
/*  Env vars are read once at module load. Override per-call by       */
/*  passing `model` explicitly to callAnthropic / generateText.       */
/* ------------------------------------------------------------------ */

const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';
const TUTOR_MODEL = process.env.MODEL_TUTOR ?? DEFAULT_MODEL;
const SYNTHESIS_MODEL = process.env.MODEL_SYNTHESIS ?? DEFAULT_MODEL;

export const MODELS = {
  router: TUTOR_MODEL,
  tutor: TUTOR_MODEL,
  judge: process.env.MODEL_JUDGE ?? DEFAULT_MODEL,
  synthesis: SYNTHESIS_MODEL,
} as const;
