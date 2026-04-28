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
  decision: string;
  reasons: string[];
}

interface RejectionRecord {
  headline: string;
  url: string;
  source_domain: string;
  published_at: string | null;
  event_match_score: number;
  decision: string;
  reasons: string[];
}

const PUBLICATION_WINDOW_DAYS = 7;

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

function referenceYearsForDateCheck(
  signature: EventSignature,
  articlePublishedAt?: string | null
): number[] {
  const articleYear = articlePublishedAt ? Date.parse(articlePublishedAt) : Number.NaN;
  if (Number.isFinite(articleYear)) {
    return [new Date(articleYear).getUTCFullYear()];
  }
  return extractYears(signature.time_window);
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

function isWithinPublicationWindow(
  candidateDate: string | null,
  articleDate: string | null,
  windowDays: number
): { within: boolean; reason?: string } {
  if (!articleDate) return { within: true };
  const articleMs = Date.parse(articleDate);
  if (!Number.isFinite(articleMs)) return { within: true };

  if (!candidateDate) {
    return { within: false, reason: 'missing_candidate_published_at' };
  }
  const candidateMs = Date.parse(candidateDate);
  if (!Number.isFinite(candidateMs)) {
    return { within: false, reason: 'unparseable_candidate_date' };
  }

  const deltaMs = Math.abs(candidateMs - articleMs);
  const deltaDays = deltaMs / (1000 * 60 * 60 * 24);
  if (deltaDays > windowDays) {
    return {
      within: false,
      reason: `outside_publication_window (${Math.round(deltaDays)}d delta, max ${windowDays}d)`,
    };
  }
  return { within: true };
}

function classifyCandidateMatch(
  candidate: DiscoveryCandidate,
  signature: EventSignature,
  articlePublishedAt?: string | null
): MatchClassification {
  const reasons: string[] = [];
  const combined = `${candidate.headline} ${candidate.snippet}`;
  const lowerHeadline = candidate.headline.toLowerCase();
  const lowerCombined = combined.toLowerCase();
  const primaryActor = signature.key_actors[0] ?? '';
  const primaryActorOverlap =
    overlapCount(uniqueTokens(primaryActor), uniqueTokens(combined)) > 0;
  const referenceYears = referenceYearsForDateCheck(signature, articlePublishedAt ?? null);

  if (/\/topic\/|\/topics\//.test(candidate.url) || /times topics|page \d+ of|topic page/i.test(lowerCombined)) {
    reasons.push('topic_or_index_page');
    return { usable: false, decision: 'topic_or_index_page', reasons };
  }

  const pubCheck = isWithinPublicationWindow(
    candidate.published_at,
    articlePublishedAt ?? null,
    PUBLICATION_WINDOW_DAYS
  );
  if (!pubCheck.within) {
    if (pubCheck.reason === 'missing_candidate_published_at') {
      const hasStrongEvidence =
        primaryActorOverlap &&
        candidate.event_match_score >= 7 &&
        (candidate.tier === 'tier1' || candidate.tier === 'tier2_open');
      if (!hasStrongEvidence) {
        reasons.push(pubCheck.reason);
        return { usable: false, decision: 'insufficient_evidence', reasons };
      }
    } else {
      reasons.push(pubCheck.reason!);
      return { usable: false, decision: 'outside_publication_window', reasons };
    }
  }

  const candidateYears = extractYears(`${candidate.url} ${combined}`);
  if (referenceYears.length > 0 && candidateYears.length > 0) {
    const closestYearDelta = Math.min(
      ...candidateYears.flatMap((candidateYear) =>
        referenceYears.map((referenceYear) => Math.abs(candidateYear - referenceYear))
      )
    );
    if (closestYearDelta > 0) {
      reasons.push('explicit_date_conflict');
      return { usable: false, decision: 'explicit_date_conflict', reasons };
    }
  }

  if (!primaryActorOverlap && candidate.event_match_score < 5) {
    reasons.push('missing_primary_actor');
    return { usable: false, decision: 'missing_primary_actor', reasons };
  }

  if (/explainer|what to know|history of|background/i.test(lowerHeadline) && candidate.event_match_score < 7) {
    reasons.push('background_or_explainer');
    return { usable: false, decision: 'background_or_explainer', reasons };
  }

  if (candidate.event_match_score < 5) {
    reasons.push('low_event_match_score');
    return { usable: false, decision: 'low_event_match_score', reasons };
  }

  return { usable: true, decision: 'exact_event_match', reasons: [] };
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
  signature: EventSignature,
  articlePublishedAt?: string | null
): {
  usable: DiscoveryCandidate[];
  rejected: RejectionRecord[];
} {
  const usable: DiscoveryCandidate[] = [];
  const rejected: RejectionRecord[] = [];

  for (const candidate of candidates) {
    const classification = classifyCandidateMatch(candidate, signature, articlePublishedAt);
    if (classification.usable) {
      usable.push(candidate);
      continue;
    }
    rejected.push({
      headline: candidate.headline,
      url: candidate.url,
      source_domain: candidate.source_domain,
      published_at: candidate.published_at,
      event_match_score: candidate.event_match_score,
      decision: classification.decision,
      reasons: classification.reasons,
    });
  }

  return { usable, rejected };
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
  // Combine tier1 + tier2_open into one pass to halve Tavily API calls
  const passes: TavilyPassSpec[] = [
    { label: 'tier1_tier2_open', includeDomains: [...SOURCES.tier1, ...SOURCES.tier2_open], maxResults: 10 },
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
  articlePublishedAt?: string;
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

  const { usable, rejected } = splitByMatchStrength(sorted, input.signature, input.articlePublishedAt);
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
      article_published_at: input.articlePublishedAt ?? null,
      publication_window_days: PUBLICATION_WINDOW_DAYS,
      total_candidates_before_gating: sorted.length,
      accepted_exact_matches: usable.map((c) => ({
        headline: c.headline,
        url: c.url,
        source_domain: c.source_domain,
        published_at: c.published_at,
        event_match_score: c.event_match_score,
      })),
      rejected_candidates: rejected,
      selected_before_rebalance: finalized,
      selected_after_rebalance: rebalanced.selected,
      rebalance_warning: rebalanced.warning,
      rebalance_swapped: rebalanced.swapped,
    },
  };
}
