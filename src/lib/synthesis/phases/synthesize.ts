import { generateJSON, generateText } from '@/lib/llm';
import { SYNTHESIS_MODELS } from '../models';
import {
  buildSynthesisUserPrompt,
  SYNTHESIS_STRICT_APPEND,
  SYNTHESIS_SYSTEM_PROMPT,
} from '../prompts';
import type {
  ComparativeSynthesis,
  ContentExtractionResult,
  DegradedSynthesis,
  ExtractedSource,
} from '../schema';
import { comparativeSynthesisSchema } from '../schema';

type SynthesisPayload = ComparativeSynthesis | DegradedSynthesis;

function validSourceIdSet(sources: ExtractedSource[]): Set<number> {
  return new Set(sources.map((source) => source.source_id));
}

function hasOnlyValidSourceIds(ids: number[], validIds: Set<number>): boolean {
  return ids.length > 0 && ids.every((id) => validIds.has(id));
}

function sanitizeSynthesis(
  payload: ComparativeSynthesis,
  validIds: Set<number>
): {
  payload: ComparativeSynthesis;
  warnings: string[];
} {
  const warnings: string[] = [];

  const timeline = payload.timeline.filter((item) => {
    const ok = hasOnlyValidSourceIds(item.source_ids, validIds);
    if (!ok) warnings.push(`Dropped timeline item with invalid source_ids: ${item.event.slice(0, 80)}`);
    return ok;
  });

  const agreements = payload.agreements.filter((item) => {
    const ok = hasOnlyValidSourceIds(item.source_ids, validIds);
    if (!ok) warnings.push(`Dropped agreement with invalid source_ids: ${item.claim.slice(0, 80)}`);
    return ok;
  });

  const factual_disagreements = payload.factual_disagreements.filter((item) => {
    const ok = item.positions.every((position) => validIds.has(position.source_id));
    if (!ok) warnings.push(`Dropped factual disagreement with invalid source_ids: ${item.topic.slice(0, 80)}`);
    return ok;
  });

  const framing_and_labeling = payload.framing_and_labeling.filter((item) => {
    const ok = item.labels_used.every((label) => validIds.has(label.source_id));
    if (!ok) warnings.push(`Dropped framing item with invalid source_ids: ${item.subject.slice(0, 80)}`);
    return ok;
  });

  const key_entities = payload.key_entities.filter((item) => {
    const ok = hasOnlyValidSourceIds(item.source_ids, validIds);
    if (!ok) warnings.push(`Dropped key entity with invalid source_ids: ${item.name.slice(0, 80)}`);
    return ok;
  });

  return {
    payload: {
      ...payload,
      timeline,
      agreements,
      factual_disagreements,
      framing_and_labeling,
      key_entities,
    },
    warnings,
  };
}

export async function synthesizeComparativeDossier(input: {
  articleTitle: string;
  articleContent: string;
  extraction: ContentExtractionResult;
}): Promise<{
  status: 'ok' | 'degraded';
  payload: SynthesisPayload;
  warnings: string[];
  debug: Record<string, unknown>;
}> {
  const validSources = input.extraction.extracted_sources;
  const prompt = buildSynthesisUserPrompt({
    articleTitle: input.articleTitle,
    articleContent: input.articleContent,
    extractedSources: validSources,
    metadata: {
      sources_attempted: input.extraction.sources_attempted,
      sources_used: input.extraction.sources_used,
      apify_invocations: input.extraction.apify_invocations,
      paywall_count: input.extraction.paywall_count,
      limited_coverage: input.extraction.limited_coverage,
    },
  });

  const warnings: string[] = [];

  const first = await generateJSON({
    model: SYNTHESIS_MODELS.synthesis,
    system: SYNTHESIS_SYSTEM_PROMPT,
    user: prompt,
    maxTokens: 2200,
    temperature: 0,
  });

  let candidate = first;
  if (!candidate.ok || !candidate.data) {
    const second = await generateJSON({
      model: SYNTHESIS_MODELS.synthesis,
      system: `${SYNTHESIS_SYSTEM_PROMPT}\n\n${SYNTHESIS_STRICT_APPEND}`,
      user: prompt,
      maxTokens: 2200,
      temperature: 0,
    });
    candidate = second;
    if (!first.ok) warnings.push(`Synthesis retry triggered after parse failure: ${first.error ?? 'unknown error'}`);
  }

  if (candidate.ok && candidate.data) {
    const parsed = comparativeSynthesisSchema.safeParse(candidate.data);
    if (parsed.success) {
      const sanitized = sanitizeSynthesis(
        parsed.data,
        validSourceIdSet(validSources)
      );
      warnings.push(...sanitized.warnings);
      return {
        status: 'ok',
        payload: sanitized.payload,
        warnings,
        debug: {
          model: SYNTHESIS_MODELS.synthesis,
          retried: candidate !== first,
          raw_json: candidate.raw,
        },
      };
    }
    warnings.push(`Synthesis schema validation failed: ${parsed.error.issues[0]?.message ?? 'unknown error'}`);
  }

  const rawText = await generateText({
    model: SYNTHESIS_MODELS.synthesis,
    system: SYNTHESIS_SYSTEM_PROMPT,
    user: `${prompt}\n\nIf you cannot satisfy the schema, provide the best plain-text comparative summary you can.`,
    maxTokens: 1800,
    temperature: 0,
  });

  return {
    status: 'degraded',
    payload: {
      raw_text: rawText,
      synthesis_quality: 'degraded',
    },
    warnings,
    debug: {
      model: SYNTHESIS_MODELS.synthesis,
      retried: true,
      raw_json: candidate.raw,
      fallback_text: rawText,
    },
  };
}
