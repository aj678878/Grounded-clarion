import { fetchArticle } from '@/lib/guardian';
import { insertSynthesisTrace, buildPhaseRecord } from './traces';
import { extractEventSignature } from './phases/extract-event';
import { discoverSources } from './phases/discover-sources';
import { extractSourceContent } from './phases/extract-content';
import { synthesizeComparativeDossier } from './phases/synthesize';
import { updateJob } from './job-store';
import type { SourceProgress } from './job-store';
import type { CompareSourcesRequest, SynthesisTraceInput } from './schema';

function htmlToText(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

export async function runCompareSources(input: CompareSourcesRequest): Promise<{
  articleTitle: string;
  phases: SynthesisTraceInput['phases'];
  status: string;
  warnings: string[];
  cost_usd_estimate: number;
  total_duration_ms: number;
  payload: unknown;
  trace_id: number | null;
}> {
  const started = Date.now();
  const phases: SynthesisTraceInput['phases'] = [];
  const warnings: string[] = [];
  let cost_usd_estimate = 0;

  const phase1Start = Date.now();
  const articlePlain = input.article_content;
  const phase1 = await extractEventSignature({
    articleTitle: input.article_title,
    articleContent: articlePlain,
  });
  phases.push(buildPhaseRecord('event_extraction', phase1.phase_status === 'ok' ? 'ok' : 'degraded', Date.now() - phase1Start, { ...phase1.debug }));

  const phase2Start = Date.now();
  const phase2 = await discoverSources({
    signature: phase1.signature,
    articleSourceDomain: input.article_source_domain,
  });
  phases.push(buildPhaseRecord('source_discovery', phase2.result.status === 'ok' ? 'ok' : phase2.result.status === 'limited_coverage' ? 'degraded' : 'error', Date.now() - phase2Start, { ...phase2.debug }));
  warnings.push(...phase2.result.warnings);

  const phase3Start = Date.now();
  const phase3 = await extractSourceContent({
    sources: phase2.result.selected_sources,
    signature: phase1.signature,
  });
  phases.push(buildPhaseRecord('content_extraction', phase3.result.status === 'ok' ? 'ok' : phase3.result.status === 'limited_coverage' ? 'degraded' : 'error', Date.now() - phase3Start, { ...phase3.debug }));
  warnings.push(...phase3.result.warnings);

  const phase4Start = Date.now();
  const phase4 = await synthesizeComparativeDossier({
    articleTitle: input.article_title,
    articleContent: articlePlain.slice(0, 8000),
    extraction: phase3.result,
  });
  phases.push(buildPhaseRecord('synthesis', phase4.status === 'ok' ? 'ok' : 'degraded', Date.now() - phase4Start, { ...phase4.debug }));
  warnings.push(...phase4.warnings);

  cost_usd_estimate = phases.reduce((sum, phase) => sum + phase.duration_ms * 0.00001, 0);

  const tracePayload: SynthesisTraceInput = {
    article_id: input.article_id,
    thread_id: input.thread_id ?? null,
    status: phase4.status === 'ok' ? 'success' : 'partial',
    phases,
    cost_usd_estimate,
    total_duration_ms: Date.now() - started,
    bias_diversity_warning: phase2.result.bias_diversity_warning,
    apify_invocations: phase3.result.apify_invocations,
    paywall_count: phase3.result.paywall_count,
    sources_attempted: phase3.result.sources_attempted,
    sources_used: phase3.result.sources_used,
    synthesis_payload: phase4.payload as Record<string, unknown>,
  };

  const traceId = await insertSynthesisTrace(tracePayload);

  return {
    articleTitle: input.article_title,
    phases,
    status: phase4.status === 'ok' ? 'success' : 'partial',
    warnings,
    cost_usd_estimate,
    total_duration_ms: Date.now() - started,
    payload: {
      phase1: phase1.signature,
      phase2: phase2.result,
      phase3: phase3.result,
      phase4: phase4.payload,
    },
    trace_id: traceId,
  };
}

export async function runCompareSourcesAsync(
  input: CompareSourcesRequest,
  jobId: string
): Promise<void> {
  try {
    updateJob(jobId, { status: 'running', currentPhase: 1 });

    const started = Date.now();
    const phases: SynthesisTraceInput['phases'] = [];
    const warnings: string[] = [];

    const phase1Start = Date.now();
    const phase1 = await extractEventSignature({
      articleTitle: input.article_title,
      articleContent: input.article_content,
    });
    phases.push(buildPhaseRecord('event_extraction', phase1.phase_status === 'ok' ? 'ok' : 'degraded', Date.now() - phase1Start, { ...phase1.debug }));

    updateJob(jobId, { currentPhase: 2 });

    const phase2Start = Date.now();
    const phase2 = await discoverSources({
      signature: phase1.signature,
      articleSourceDomain: input.article_source_domain,
    });
    phases.push(buildPhaseRecord('source_discovery', phase2.result.status === 'ok' ? 'ok' : phase2.result.status === 'limited_coverage' ? 'degraded' : 'error', Date.now() - phase2Start, { ...phase2.debug }));
    warnings.push(...phase2.result.warnings);

    const sourceStatuses: SourceProgress[] = phase2.result.selected_sources.map((s) => ({
      source_id: s.source_id,
      name: s.source_name,
      status: 'fetching' as const,
    }));
    updateJob(jobId, { currentPhase: 3, sourceStatuses });

    const phase3Start = Date.now();
    const phase3 = await extractSourceContent({
      sources: phase2.result.selected_sources,
      signature: phase1.signature,
    });
    phases.push(buildPhaseRecord('content_extraction', phase3.result.status === 'ok' ? 'ok' : phase3.result.status === 'limited_coverage' ? 'degraded' : 'error', Date.now() - phase3Start, { ...phase3.debug }));
    warnings.push(...phase3.result.warnings);

    const extractedIds = new Set(phase3.result.extracted_sources.map((s) => s.source_id));
    const updatedSourceStatuses: SourceProgress[] = sourceStatuses.map((s) => ({
      ...s,
      status: extractedIds.has(s.source_id) ? 'done' as const : 'failed' as const,
    }));
    updateJob(jobId, { currentPhase: 4, sourceStatuses: updatedSourceStatuses });

    const phase4Start = Date.now();
    const phase4 = await synthesizeComparativeDossier({
      articleTitle: input.article_title,
      articleContent: input.article_content.slice(0, 8000),
      extraction: phase3.result,
    });
    phases.push(buildPhaseRecord('synthesis', phase4.status === 'ok' ? 'ok' : 'degraded', Date.now() - phase4Start, { ...phase4.debug }));
    warnings.push(...phase4.warnings);

    const cost_usd_estimate = phases.reduce((sum, phase) => sum + phase.duration_ms * 0.00001, 0);

    const tracePayload: SynthesisTraceInput = {
      article_id: input.article_id,
      thread_id: input.thread_id ?? null,
      status: phase4.status === 'ok' ? 'success' : 'partial',
      phases,
      cost_usd_estimate,
      total_duration_ms: Date.now() - started,
      bias_diversity_warning: phase2.result.bias_diversity_warning,
      apify_invocations: phase3.result.apify_invocations,
      paywall_count: phase3.result.paywall_count,
      sources_attempted: phase3.result.sources_attempted,
      sources_used: phase3.result.sources_used,
      synthesis_payload: phase4.payload as Record<string, unknown>,
    };

    await insertSynthesisTrace(tracePayload);

    updateJob(jobId, {
      status: 'done',
      result: {
        articleTitle: input.article_title,
        phases,
        status: phase4.status === 'ok' ? 'success' : 'partial',
        warnings,
        cost_usd_estimate,
        total_duration_ms: Date.now() - started,
        payload: {
          phase1: phase1.signature,
          phase2: phase2.result,
          phase3: phase3.result,
          phase4: phase4.payload,
        },
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Pipeline failed';
    updateJob(jobId, { status: 'error', error: message });
  }
}

export async function buildCompareSourcesRequest(articleId: string): Promise<CompareSourcesRequest> {
  const article = await fetchArticle(articleId);
  const plain = htmlToText(article.bodyHtml);
  return {
    article_id: article.id,
    article_title: article.webTitle,
    article_content: plain,
    article_source_url: article.webUrl,
    article_source_domain: new URL(article.webUrl).hostname.replace(/^www\./, ''),
    thread_id: undefined,
  };
}
