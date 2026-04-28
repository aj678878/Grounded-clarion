import { z } from 'zod';

export const ORIGINAL_ARTICLE_SOURCE_ID = 0;

export const eventTypeSchema = z.enum([
  'incident',
  'policy',
  'election',
  'financial',
  'scientific',
  'geopolitical',
  'sports',
  'cultural',
  'other',
]);

export const regionalFocusSchema = z.enum([
  'asia',
  'europe',
  'north_america',
  'south_america',
  'africa',
  'middle_east',
  'global',
]);

export const phaseStatusSchema = z.enum(['ok', 'degraded_fallback', 'degraded', 'error']);

export const compareSourcesRequestSchema = z.object({
  article_id: z.string().min(1),
  article_title: z.string().min(1),
  article_content: z.string().min(1),
  article_source_url: z.string().url(),
  article_source_domain: z.string().min(1),
  article_published_at: z.string().min(1).optional(),
  thread_id: z.string().min(1).optional(),
});

export const eventSignatureSchema = z.object({
  event_type: eventTypeSchema,
  key_actors: z.array(z.string().min(1)).min(2).max(5),
  location: z.string().min(1).nullable(),
  time_window: z.string().min(1),
  search_query: z.string().min(3).max(120),
  regional_focus: regionalFocusSchema.nullable(),
});

export const synthesisPhaseRecordSchema = z.object({
  phase: z.enum([
    'event_extraction',
    'source_discovery',
    'content_extraction',
    'synthesis',
  ]),
  status: phaseStatusSchema,
  duration_ms: z.number().int().nonnegative(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const biasLeanSchema = z.enum([
  'left',
  'lean-left',
  'center-left',
  'center',
  'center-right',
  'lean-right',
  'right',
  'unknown',
]);

export const sourceTierSchema = z.enum([
  'tier1',
  'tier2_open',
  'tier2_paywall',
  'tier3_regional',
  'unranked',
]);

export const discoveredSourceSchema = z.object({
  source_id: z.number().int().positive(),
  source_name: z.string().min(1),
  source_domain: z.string().min(1),
  headline: z.string().min(1),
  url: z.string().url(),
  published_at: z.string().nullable(),
  snippet: z.string().default(''),
  tier: sourceTierSchema,
  bias_lean: biasLeanSchema,
});

export const sourceDiscoveryResultSchema = z.object({
  status: z.enum(['ok', 'limited_coverage', 'error']),
  error_phase: z.literal('source_discovery').optional(),
  limited_coverage: z.boolean(),
  bias_diversity_warning: z.boolean(),
  provider_used: z.enum(['tavily', 'anthropic_web_search']),
  search_query: z.string().min(1),
  candidates_considered: z.number().int().nonnegative(),
  selected_sources: z.array(discoveredSourceSchema),
  warnings: z.array(z.string()),
});

export const extractionQualitySchema = z.enum([
  'full',
  'snippet_only',
  'paywall_partial',
  'apify_full',
  'failed',
]);

export const extractionMethodSchema = z.enum([
  'tavily',
  'apify',
  'snippet_fallback',
]);

export const extractedSourceSchema = z.object({
  source_id: z.number().int().positive(),
  source_name: z.string().min(1),
  source_domain: z.string().min(1),
  headline: z.string().min(1),
  url: z.string().url(),
  published_at: z.string().nullable(),
  content: z.string(),
  extraction_quality: extractionQualitySchema,
  extraction_method: extractionMethodSchema,
  word_count: z.number().int().nonnegative(),
  bias_lean: biasLeanSchema,
});

export const contentExtractionResultSchema = z.object({
  status: z.enum(['ok', 'limited_coverage', 'error']),
  error_phase: z.literal('content_extraction').optional(),
  sources_attempted: z.number().int().nonnegative(),
  sources_used: z.number().int().nonnegative(),
  paywall_count: z.number().int().nonnegative(),
  apify_invocations: z.number().int().nonnegative(),
  limited_coverage: z.boolean(),
  extracted_sources: z.array(extractedSourceSchema),
  warnings: z.array(z.string()),
});

/** Retained for a future v2 timeline section in the dossier (not emitted by synthesis v1). */
export const synthesisTimelineItemSchema = z.object({
  datetime: z.string().min(1),
  event: z.string().min(1),
  source_ids: z.array(z.number().int().positive()).min(1),
});

export const synthesisAgreementSchema = z.object({
  claim: z.string().min(1),
  source_ids: z.array(z.number().int().nonnegative()).min(2),
});

export const synthesisPositionSchema = z.object({
  source_id: z.number().int().nonnegative(),
  position: z.string().min(1),
});

export const synthesisFactualDisagreementSchema = z.object({
  topic: z.string().min(1),
  positions: z.array(synthesisPositionSchema).min(2),
});

export const synthesisLabelSchema = z.object({
  source_id: z.number().int().nonnegative(),
  label: z.string().min(1),
});

export const synthesisFramingSchema = z.object({
  subject: z.string().min(1),
  labels_used: z.array(synthesisLabelSchema).min(2),
  interpretation: z.string().min(1),
});

export const synthesisEntitySchema = z.object({
  name: z.string().min(1),
  role: z.string().min(1),
  source_ids: z.array(z.number().int().nonnegative()).min(1),
});

// v2: add timeline: z.array(synthesisTimelineItemSchema) when chronological dossier returns.
export const comparativeSynthesisSchema = z.object({
  summary: z.string().min(1),
  agreements: z.array(synthesisAgreementSchema),
  factual_disagreements: z.array(synthesisFactualDisagreementSchema),
  framing_and_labeling: z.array(synthesisFramingSchema),
  key_entities: z.array(synthesisEntitySchema),
  open_questions: z.array(z.string().min(1)),
  limited_coverage: z.boolean(),
  metadata: z.object({
    sources_attempted: z.number().int().nonnegative(),
    sources_used: z.number().int().nonnegative(),
    apify_invocations: z.number().int().nonnegative(),
    paywall_count: z.number().int().nonnegative(),
  }),
});

export const degradedSynthesisSchema = z.object({
  raw_text: z.string().min(1),
  synthesis_quality: z.literal('degraded'),
});

export const synthesisTraceSchema = z.object({
  article_id: z.string().min(1),
  thread_id: z.string().min(1).nullable().optional(),
  status: z.string().min(1),
  phases: z.array(synthesisPhaseRecordSchema),
  cost_usd_estimate: z.number().nonnegative().nullable().optional(),
  total_duration_ms: z.number().int().nonnegative(),
  bias_diversity_warning: z.boolean().optional(),
  apify_invocations: z.number().int().nonnegative().optional(),
  paywall_count: z.number().int().nonnegative().optional(),
  sources_attempted: z.number().int().nonnegative().nullable().optional(),
  sources_used: z.number().int().nonnegative().nullable().optional(),
  synthesis_payload: z.record(z.string(), z.unknown()).nullable().optional(),
});

export type CompareSourcesRequest = z.infer<typeof compareSourcesRequestSchema>;
export type EventSignature = z.infer<typeof eventSignatureSchema>;
export type SynthesisPhaseRecord = z.infer<typeof synthesisPhaseRecordSchema>;
export type SynthesisTraceInput = z.infer<typeof synthesisTraceSchema>;
export type BiasLean = z.infer<typeof biasLeanSchema>;
export type SourceTier = z.infer<typeof sourceTierSchema>;
export type DiscoveredSource = z.infer<typeof discoveredSourceSchema>;
export type SourceDiscoveryResult = z.infer<typeof sourceDiscoveryResultSchema>;
export type ExtractionQuality = z.infer<typeof extractionQualitySchema>;
export type ExtractionMethod = z.infer<typeof extractionMethodSchema>;
export type ExtractedSource = z.infer<typeof extractedSourceSchema>;
export type ContentExtractionResult = z.infer<typeof contentExtractionResultSchema>;
export type ComparativeSynthesis = z.infer<typeof comparativeSynthesisSchema>;
export type DegradedSynthesis = z.infer<typeof degradedSynthesisSchema>;
