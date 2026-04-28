import { insertSynthesisTrace, buildPhaseRecord, type SynthesisTraceInsertResult } from './traces';
import { extractEventSignature } from './phases/extract-event';
import { discoverSources } from './phases/discover-sources';
import { extractSourceContent } from './phases/extract-content';
import { synthesizeComparativeDossier } from './phases/synthesize';
import { updateJob } from './job-store';
import type { SourceProgress } from './job-store';
import type { CompareSourcesRequest, SynthesisTraceInput } from './schema';

async function persistTraceAfterCompletion(
  tracePayload: SynthesisTraceInput,
  meta: { jobId: string; articleId: string }
): Promise<void> {
  console.info('[compare-sources] Persisting synthesis trace', {
    jobId: meta.jobId,
    article_id: meta.articleId,
    status: tracePayload.status,
  });
  try {
    const result: SynthesisTraceInsertResult = await insertSynthesisTrace(tracePayload);
    console.info('[compare-sources] Synthesis trace persistence finished', {
      jobId: meta.jobId,
      article_id: meta.articleId,
      ok: result.ok,
      reason: result.reason,
      traceId: result.traceId,
      dbTarget: result.dbTarget,
      error: result.error,
    });
  } catch (err) {
    console.error('[compare-sources] Synthesis trace persistence failed:', err);
  }
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
      articlePublishedAt: input.article_published_at,
    });
    phases.push(buildPhaseRecord('source_discovery', phase2.result.status === 'ok' ? 'ok' : phase2.result.status === 'limited_coverage' ? 'degraded' : 'error', Date.now() - phase2Start, { ...phase2.debug }));
    warnings.push(...phase2.result.warnings);

    const asyncSelectedCount = phase2.result.selected_sources.length;
    if (asyncSelectedCount === 0) {
      warnings.push('No peer sources passed the relevance gate within the comparison window.');
      const cost_usd_estimate = phases.reduce((sum, phase) => sum + phase.duration_ms * 0.00001, 0);
      const tracePayload: SynthesisTraceInput = {
        article_id: input.article_id, thread_id: input.thread_id ?? null,
        status: 'no_comparison', phases, cost_usd_estimate,
        total_duration_ms: Date.now() - started,
        bias_diversity_warning: phase2.result.bias_diversity_warning,
        sources_attempted: phase2.result.candidates_considered, sources_used: 0,
      };
      updateJob(jobId, {
        status: 'done',
        result: {
          articleTitle: input.article_title, phases,
          status: 'no_comparison', warnings, cost_usd_estimate,
          total_duration_ms: Date.now() - started,
          payload: { phase1: phase1.signature, phase2: phase2.result, phase3: null, phase4: null },
        },
      });
      await persistTraceAfterCompletion(tracePayload, {
        jobId,
        articleId: input.article_id,
      });
      return;
    }
    if (asyncSelectedCount === 1) {
      warnings.push('Only 1 matching source found — comparison is limited to a single peer outlet.');
    } else if (asyncSelectedCount === 2) {
      warnings.push('Limited comparison — only 2 matching sources found.');
    }

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
    await persistTraceAfterCompletion(tracePayload, {
      jobId,
      articleId: input.article_id,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Pipeline failed';
    updateJob(jobId, { status: 'error', error: message });
  }
}

