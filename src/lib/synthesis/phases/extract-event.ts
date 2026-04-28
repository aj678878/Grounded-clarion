import { generateJSON } from '@/lib/llm';
import { EVENT_EXTRACTION_STRICT_APPEND, EVENT_EXTRACTION_SYSTEM_PROMPT, buildEventExtractionUserPrompt } from '../prompts';
import { eventSignatureSchema, type EventSignature } from '../schema';
import { SYNTHESIS_MODELS } from '../models';

const MAX_ROUTING_WORDS = 600;
const MAX_OUTPUT_TOKENS = 220;

export interface EventExtractionDebug {
  model: string;
  article_excerpt_used: string;
  raw_outputs: string[];
  parse_errors: string[];
  validation_errors: string[];
  used_fallback: boolean;
  attempts: number;
}

export interface EventExtractionResult {
  phase_status: 'ok' | 'degraded_fallback';
  signature: EventSignature;
  debug: EventExtractionDebug;
}

function toWordExcerpt(text: string, maxWords: number): string {
  const words = text.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  if (words.length <= maxWords) return words.join(' ');
  return `${words.slice(0, maxWords).join(' ')}\n…[article truncated for event extraction]`;
}

function buildFallbackEventSignature(articleTitle: string): EventSignature {
  return {
    event_type: 'other',
    key_actors: ['Unknown actor', 'Unknown subject'],
    location: null,
    time_window: 'current coverage period',
    search_query: articleTitle.trim().slice(0, 120) || 'news event',
    regional_focus: null,
  };
}

async function runAttempt(input: {
  articleTitle: string;
  articleExcerpt: string;
  strict: boolean;
}) {
  const user = buildEventExtractionUserPrompt({
    articleTitle: input.articleTitle,
    articleExcerpt: input.articleExcerpt,
  });

  const system = input.strict
    ? `${EVENT_EXTRACTION_SYSTEM_PROMPT}\n\n${EVENT_EXTRACTION_STRICT_APPEND}`
    : EVENT_EXTRACTION_SYSTEM_PROMPT;

  return generateJSON({
    model: SYNTHESIS_MODELS.eventExtraction,
    system,
    user,
    maxTokens: MAX_OUTPUT_TOKENS,
  });
}

export async function extractEventSignature(input: {
  articleTitle: string;
  articleContent: string;
}): Promise<EventExtractionResult> {
  const articleExcerpt = toWordExcerpt(input.articleContent, MAX_ROUTING_WORDS);
  const model = SYNTHESIS_MODELS.eventExtraction;
  const raw_outputs: string[] = [];
  const parse_errors: string[] = [];
  const validation_errors: string[] = [];

  for (const strict of [false, true]) {
    const attempt = await runAttempt({
      articleTitle: input.articleTitle,
      articleExcerpt,
      strict,
    });

    raw_outputs.push(attempt.raw);

    if (!attempt.ok || !attempt.data) {
      parse_errors.push(attempt.error ?? 'JSON generation failed');
      continue;
    }

    const validated = eventSignatureSchema.safeParse(attempt.data);
    if (!validated.success) {
      validation_errors.push(validated.error.issues.map((issue) => issue.message).join('; '));
      continue;
    }

    return {
      phase_status: 'ok',
      signature: validated.data,
      debug: {
        model,
        article_excerpt_used: articleExcerpt,
        raw_outputs,
        parse_errors,
        validation_errors,
        used_fallback: false,
        attempts: strict ? 2 : 1,
      },
    };
  }

  return {
    phase_status: 'degraded_fallback',
    signature: buildFallbackEventSignature(input.articleTitle),
    debug: {
      model,
      article_excerpt_used: articleExcerpt,
      raw_outputs,
      parse_errors,
      validation_errors,
      used_fallback: true,
      attempts: 2,
    },
  };
}
