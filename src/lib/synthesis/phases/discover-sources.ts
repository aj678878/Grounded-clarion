import { searchAnthropicWebForDiscovery } from '../providers/anthropic-search';
import { searchTavilyForDiscovery, type TavilyDiscoveryCandidate } from '../providers/tavily-client';
import { applyBiasDiversityCheck } from '../bias-diversity-check';
import { SYNTHESIS_MODELS } from '../models';
import {
  getBiasLean,
  getDomainFamily,
  inferSourceTier,
  isExcludedDomain,
  normalizeDomain,
  tierScore,
  SOURCES,
} from '../source-tiers';
import type { DiscoveredSource, EventSignature, SourceDiscoveryResult, SourceTier } from '../schema';
import { sourceDiscoveryResultSchema } from '../schema';

interface DiscoveryCandidate {
  headline: string;
  url: string;
  source_domain: string;
  source_name: string;
  snippet: string;
  published_at: string | null;
  tier: SourceTier;
  event_match_score: number;
  domain_family: string;
}

interface MatchClassification {
  usable: boolean;
  reasons: string[];
}

interface TavilyPassSpec {
  label: string;
  includeDomains?: readonly string[];
  maxResults: number;
}

function parseRecency(value: string | null): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function sortCandidates(candidates: DiscoveryCandidate[]): DiscoveryCandidate[] {
  return [...candidates].sort((a, b) => {
    const scoreDelta = tierScore(b.tier) - tierScore(a.tier);
    if (scoreDelta !== 0) return scoreDelta;
    const matchDelta = b.event_match_score - a.event_match_score;
    if (matchDelta !== 0) return matchDelta;
    return parseRecency(b.published_at) - parseRecency(a.published_at);
  });
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3);
}

function uniqueTokens(text: string): Set<string> {
  return new Set(tokenize(text));
}

function overlapCount(a: Set<string>, b: Set<string>): number {
  let count = 0;
  a.forEach((token) => {
    if (b.has(token)) count += 1;
  });
  return count;
}

function extractTimeTokens(timeWindow: string): Set<string> {
  return new Set(tokenize(timeWindow).filter((token) => /\d{4}|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec/.test(token)));
}

function extractYears(text: string): number[] {
  const matches = text.match(/\b(19|20)\d{2}\b/g) ?? [];
  return matches
    .map((year) => Number.parseInt(year, 10))
    .filter((year) => Number.isFinite(year));
}

function scoreEventMatch(
  row: Pick<DiscoveryCandidate, 'headline' | 'snippet'>,
  signature: EventSignature
): number {
  const haystack = `${row.headline} ${row.snippet}`;
  const haystackTokens = uniqueTokens(haystack);
  const queryTokens = uniqueTokens(signature.search_query);
  const locationTokens = uniqueTokens(signature.location ?? '');
  const timeTokens = extractTimeTokens(signature.time_window);

  let score = 0;

  const queryOverlap = overlapCount(queryTokens, haystackTokens);
  score += queryOverlap * 2;

  const actorHits = signature.key_actors.reduce((hits, actor) => {
    const actorTokens = uniqueTokens(actor);
    return hits + (overlapCount(actorTokens, haystackTokens) > 0 ? 1 : 0);
  }, 0);
  score += actorHits * 2;

  const primaryActorTokens = uniqueTokens(signature.key_actors[0] ?? '');
  const primaryActorOverlap = overlapCount(primaryActorTokens, haystackTokens);
  if (primaryActorOverlap > 0) {
    score += 3;
  } else if (queryOverlap >= 2) {
    score -= 3;
  }

  const locationOverlap = overlapCount(locationTokens, haystackTokens);
  score += Math.min(locationOverlap, 2);

  const timeOverlap = overlapCount(timeTokens, haystackTokens);
  score += Math.min(timeOverlap, 1);

  const lowerText = haystack.toLowerCase();
  if (/explainer|what is|history of|background|analysis/.test(lowerText)) {
    score -= 2;
  }
  if (/live blog|as it happened|live updates/.test(lowerText)) {
    score -= 1;
  }

  return score;
}

function classifyCandidateMatch(
  candidate: DiscoveryCandidate,
  signature: EventSignature
): MatchClassification {
  const reasons: string[] = [];
  const combined = `${candidate.headline} ${candidate.snippet}`;
  const lowerHeadline = candidate.headline.toLowerCase();
  const lowerCombined = combined.toLowerCase();
  const primaryActor = signature.key_actors[0] ?? '';
  const primaryActorOverlap =
    overlapCount(uniqueTokens(primaryActor), uniqueTokens(combined)) > 0;

  if (/\/topic\/|\/topics\//.test(candidate.url) || /times topics|page \d+ of|topic page/i.test(lowerCombined)) {
    reasons.push('topic_or_index_page');
  }

  const signatureYears = extractYears(signature.time_window);
  const candidateYears = extractYears(`${candidate.url} ${combined}`);
  if (signatureYears.length > 0 && candidateYears.length > 0) {
    const closestYearDelta = Math.min(
      ...candidateYears.flatMap((candidateYear) =>
        signatureYears.map((signatureYear) => Math.abs(candidateYear - signatureYear))
      )
    );
    if (closestYearDelta > 4) {
      reasons.push('stale_year_mismatch');
    }
  }

  if (!primaryActorOverlap && candidate.event_match_score < 5) {
    reasons.push('missing_primary_actor_for_low_match');
  }

  if (/explainer|what to know|history of|background/i.test(lowerHeadline) && candidate.event_match_score < 7) {
    reasons.push('background_or_explainer');
  }

  if (candidate.event_match_score < 5) {
    reasons.push('low_event_match_score');
  }

  return {
    usable: reasons.length === 0,
    reasons,
  };
}

function dedupeByUrl<T extends { url: string }>(rows: T[]): T[] {
  const seen = new Set<string>();
  return rows.filter((row) => {
    const key = row.url.trim();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function toDiscoveryCandidates(
  rows: TavilyDiscoveryCandidate[],
  input: {
    originDomain: string;
    regionalFocus: EventSignature['regional_focus'];
    signature: EventSignature;
  }
): DiscoveryCandidate[] {
  const originDomain = normalizeDomain(input.originDomain);
  return dedupeByUrl(
    rows
      .map((row) => ({
        ...row,
        source_domain: normalizeDomain(row.source_domain),
      }))
      .filter((row) => row.source_domain && row.source_domain !== originDomain)
      .filter((row) => !isExcludedDomain(row.source_domain))
      .map((row) => ({
        ...row,
        tier: inferSourceTier(row.source_domain, input.regionalFocus),
        event_match_score: scoreEventMatch(row, input.signature),
        domain_family: getDomainFamily(row.source_domain),
      }))
  );
}

function takeByTier(
  candidates: DiscoveryCandidate[],
  tier: SourceTier,
  maxCount: number,
  taken: Set<string>,
  usedFamilies: Set<string>
): DiscoveryCandidate[] {
  const picked: DiscoveryCandidate[] = [];
  for (const candidate of candidates) {
    if (candidate.tier !== tier) continue;
    if (taken.has(candidate.url)) continue;
    if (usedFamilies.has(candidate.domain_family)) continue;
    picked.push(candidate);
    taken.add(candidate.url);
    usedFamilies.add(candidate.domain_family);
    if (picked.length >= maxCount) break;
  }
  return picked;
}

function addRegionalSources(
  selected: DiscoveryCandidate[],
  candidates: DiscoveryCandidate[],
  regionalFocus: EventSignature['regional_focus'],
  taken: Set<string>,
  usedFamilies: Set<string>
): DiscoveryCandidate[] {
  if (!regionalFocus) return selected;
  if (!(regionalFocus in SOURCES.tier3_regional)) return selected;

  const regionalPicked = takeByTier(candidates, 'tier3_regional', 2, taken, usedFamilies);
  return [...selected, ...regionalPicked];
}

function backfillRemaining(
  selected: DiscoveryCandidate[],
  candidates: DiscoveryCandidate[],
  taken: Set<string>,
  usedFamilies: Set<string>,
  maxTotal: number
): DiscoveryCandidate[] {
  const next = [...selected];
  for (const candidate of candidates) {
    if (next.length >= maxTotal) break;
    if (taken.has(candidate.url)) continue;
    if (usedFamilies.has(candidate.domain_family)) continue;
    next.push(candidate);
    taken.add(candidate.url);
    usedFamilies.add(candidate.domain_family);
  }
  return next;
}

function splitByMatchStrength(
  candidates: DiscoveryCandidate[],
  signature: EventSignature
): {
  usable: DiscoveryCandidate[];
  weak: DiscoveryCandidate[];
  removed: Array<{
    headline: string;
    url: string;
    source_domain: string;
    event_match_score: number;
    reasons: string[];
  }>;
} {
  const usable: DiscoveryCandidate[] = [];
  const weak: DiscoveryCandidate[] = [];
  const removed: Array<{
    headline: string;
    url: string;
    source_domain: string;
    event_match_score: number;
    reasons: string[];
  }> = [];

  for (const candidate of candidates) {
    const classification = classifyCandidateMatch(candidate, signature);
    if (classification.usable) {
      usable.push(candidate);
      continue;
    }
    weak.push(candidate);
    removed.push({
      headline: candidate.headline,
      url: candidate.url,
      source_domain: candidate.source_domain,
      event_match_score: candidate.event_match_score,
      reasons: classification.reasons,
    });
  }

  return { usable, weak, removed };
}

function toDiscoveredSources(selected: DiscoveryCandidate[], limit = 6): DiscoveredSource[] {
  return selected.slice(0, limit).map((candidate, index) => ({
    source_id: index + 1,
    source_name: candidate.source_name,
    source_domain: candidate.source_domain,
    headline: candidate.headline,
    url: candidate.url,
    published_at: candidate.published_at,
    snippet: candidate.snippet,
    tier: candidate.tier,
    bias_lean: getBiasLean(candidate.source_domain),
  }));
}

function buildTavilyPasses(signature: EventSignature): TavilyPassSpec[] {
  const passes: TavilyPassSpec[] = [
    { label: 'tier1', includeDomains: SOURCES.tier1, maxResults: 6 },
    { label: 'tier2_open', includeDomains: SOURCES.tier2_open, maxResults: 6 },
    { label: 'tier2_paywall', includeDomains: SOURCES.tier2_paywall, maxResults: 5 },
  ];

  if (
    signature.regional_focus &&
    signature.regional_focus in SOURCES.tier3_regional
  ) {
    passes.push({
      label: `regional_${signature.regional_focus}`,
      includeDomains:
        SOURCES.tier3_regional[
          signature.regional_focus as keyof typeof SOURCES.tier3_regional
        ],
      maxResults: 4,
    });
  }

  return passes;
}

async function runTargetedTavilyPasses(signature: EventSignature) {
  const passes = buildTavilyPasses(signature);
  const settled = await Promise.all(
    passes.map(async (pass) => ({
      label: pass.label,
      includeDomains: pass.includeDomains ?? [],
      result: await searchTavilyForDiscovery({
        query: signature.search_query,
        maxResults: pass.maxResults,
        includeDomains: pass.includeDomains,
      }),
    }))
  );

  return settled;
}

export async function discoverSources(input: {
  signature: EventSignature;
  articleSourceDomain: string;
  anthropicFallbackModel?: string;
}): Promise<{
  result: SourceDiscoveryResult;
  debug: Record<string, unknown>;
}> {
  const warnings: string[] = [];
  let providerUsed: SourceDiscoveryResult['provider_used'] = 'tavily';
  let debug: Record<string, unknown> = {};

  const targetedPasses = await runTargetedTavilyPasses(input.signature);
  const targetedFailures = targetedPasses.filter(({ result }) => !result.ok);
  const targetedCandidates = targetedPasses.flatMap(({ result }) =>
    result.ok ? result.candidates : []
  );

  let rawCandidates = toDiscoveryCandidates(targetedCandidates, {
    originDomain: input.articleSourceDomain,
    regionalFocus: input.signature.regional_focus,
    signature: input.signature,
  });

  debug = {
    tavily_passes: targetedPasses.map(({ label, includeDomains, result }) => ({
      label,
      include_domains: includeDomains,
      ok: result.ok,
      timed_out: result.timedOut,
      error: result.error,
      request_payload: result.request_payload,
      raw_response: result.raw_response,
      candidate_count: result.candidates.length,
    })),
  };

  for (const failed of targetedFailures) {
    warnings.push(failed.result.error ?? `Tavily ${failed.label} discovery failed`);
  }

  let sorted = sortCandidates(rawCandidates);
  const targetedLikelySparse = sorted.length < 3;

  if (targetedLikelySparse) {
    const broad = await searchTavilyForDiscovery({
      query: input.signature.search_query,
      maxResults: 10,
    });

    debug = {
      ...debug,
      tavily_broad_fallback: {
        ok: broad.ok,
        timed_out: broad.timedOut,
        error: broad.error,
        request_payload: broad.request_payload,
        raw_response: broad.raw_response,
        candidate_count: broad.candidates.length,
      },
    };

    if (broad.ok) {
      rawCandidates = dedupeByUrl([
        ...rawCandidates,
        ...toDiscoveryCandidates(broad.candidates, {
          originDomain: input.articleSourceDomain,
          regionalFocus: input.signature.regional_focus,
          signature: input.signature,
        }),
      ]);
      sorted = sortCandidates(rawCandidates);
    } else {
      warnings.push(broad.error ?? 'Tavily broad fallback failed');
    }
  }

  if (sorted.length === 0) {
    const fallbackModel =
      input.anthropicFallbackModel ?? SYNTHESIS_MODELS.anthropicWebSearchFallback;
    if (!fallbackModel) {
      const errorResult: SourceDiscoveryResult = {
        status: 'error',
        error_phase: 'source_discovery',
        limited_coverage: true,
        bias_diversity_warning: false,
        provider_used: 'tavily',
        search_query: input.signature.search_query,
        candidates_considered: 0,
        selected_sources: [],
        warnings,
      };
      return { result: sourceDiscoveryResultSchema.parse(errorResult), debug };
    }

    providerUsed = 'anthropic_web_search';
    const anthropic = await searchAnthropicWebForDiscovery({
      query: input.signature.search_query,
      model: fallbackModel,
      maxUses: 3,
      blockedDomains: SOURCES.excluded,
    });

    debug = {
      ...debug,
      anthropic_fallback: anthropic,
    };

    if (!anthropic.ok) {
      warnings.push(anthropic.error ?? 'Anthropic web search fallback failed');
      const errorResult: SourceDiscoveryResult = {
        status: 'error',
        error_phase: 'source_discovery',
        limited_coverage: true,
        bias_diversity_warning: false,
        provider_used: providerUsed,
        search_query: input.signature.search_query,
        candidates_considered: 0,
        selected_sources: [],
        warnings,
      };
      return { result: sourceDiscoveryResultSchema.parse(errorResult), debug };
    }

    rawCandidates = toDiscoveryCandidates(anthropic.candidates, {
      originDomain: input.articleSourceDomain,
      regionalFocus: input.signature.regional_focus,
      signature: input.signature,
    });
    sorted = sortCandidates(rawCandidates);
  }

  const { usable, weak, removed } = splitByMatchStrength(sorted, input.signature);
  const rankedPool = usable;

  const taken = new Set<string>();
  const usedFamilies = new Set<string>();
  let selected = [
    ...takeByTier(rankedPool, 'tier1', 3, taken, usedFamilies),
    ...takeByTier(rankedPool, 'tier2_open', 2, taken, usedFamilies),
  ];

  selected = addRegionalSources(selected, rankedPool, input.signature.regional_focus, taken, usedFamilies);
  selected = [...selected, ...takeByTier(rankedPool, 'tier2_paywall', 1, taken, usedFamilies)];
  selected = backfillRemaining(selected, rankedPool, taken, usedFamilies, 6);
  if (selected.length < 3 && weak.length > 0) {
    selected = backfillRemaining(selected, weak, taken, usedFamilies, 6);
  }
  selected = selected.slice(0, 6);

  const finalized = toDiscoveredSources(selected);
  const rebalanced = applyBiasDiversityCheck({
    selected: finalized,
    candidates: toDiscoveredSources(sorted, sorted.length),
  });

  const limitedCoverage = rebalanced.selected.length < 3;
  const warningFlag = rebalanced.warning;
  if (limitedCoverage) warnings.push('Limited coverage: fewer than 3 sources selected');
  if (warningFlag) warnings.push('Bias diversity warning: could not include opposing or center source');
  if (rebalanced.swapped) warnings.push('Bias diversity rebalance applied');

  const result: SourceDiscoveryResult = {
    status: limitedCoverage ? 'limited_coverage' : 'ok',
    limited_coverage: limitedCoverage,
    bias_diversity_warning: warningFlag,
    provider_used: providerUsed,
    search_query: input.signature.search_query,
    candidates_considered: sorted.length,
    selected_sources: rebalanced.selected,
    warnings,
  };

  return {
    result: sourceDiscoveryResultSchema.parse(result),
    debug: {
      ...debug,
      candidates_after_filtering: sorted,
      usable_match_candidates: usable,
      weak_match_candidates: weak,
      removed_weak_candidates: removed,
      selected_before_rebalance: finalized,
      selected_after_rebalance: rebalanced.selected,
      rebalance_warning: rebalanced.warning,
      rebalance_swapped: rebalanced.swapped,
    },
  };
}
