import { MODELS } from '@/lib/config';

export const SYNTHESIS_MODELS = {
  eventExtraction: MODELS.tutor,
  synthesis: MODELS.synthesis,
  anthropicWebSearchFallback: 'claude-sonnet-4-20250514',
} as const;
