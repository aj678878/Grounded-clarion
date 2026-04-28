#!/usr/bin/env tsx

import { config } from 'dotenv';
import * as path from 'path';

config({ path: path.resolve(process.cwd(), '.env.local') });

import { fetchArticle } from '../src/lib/guardian';
import { extractEventSignature } from '../src/lib/synthesis/phases/extract-event';
import { discoverSources } from '../src/lib/synthesis/phases/discover-sources';
import { extractSourceContent } from '../src/lib/synthesis/phases/extract-content';
import { synthesizeComparativeDossier } from '../src/lib/synthesis/phases/synthesize';

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

async function main() {
  const articleId =
    process.argv[2] ||
    'world/2026/apr/27/bomb-pan-american-highway-colombia-casualties-dead-ahead-may-elections';

  console.log(`[phase1] Fetching article: ${articleId}`);
  const article = await fetchArticle(articleId);
  const plainText = htmlToText(article.bodyHtml);

  const start = Date.now();
  const phase1 = await extractEventSignature({
    articleTitle: article.webTitle,
    articleContent: plainText,
  });
  const phase1DurationMs = Date.now() - start;

  const articleSourceDomain = new URL(article.webUrl).hostname.replace(/^www\./, '');

  const phase2Start = Date.now();
  const phase2 = await discoverSources({
    signature: phase1.signature,
    articleSourceDomain,
  });
  const phase2DurationMs = Date.now() - phase2Start;

  const phase3Start = Date.now();
  const phase3 = await extractSourceContent({
    sources: phase2.result.selected_sources,
    signature: phase1.signature,
  });
  const phase3DurationMs = Date.now() - phase3Start;

  const phase4Start = Date.now();
  const phase4 = await synthesizeComparativeDossier({
    articleTitle: article.webTitle,
    articleContent: plainText.slice(0, 8000),
    extraction: phase3.result,
  });
  const phase4DurationMs = Date.now() - phase4Start;

  console.log(
    JSON.stringify(
      {
        article_id: article.id,
        article_title: article.webTitle,
        phase1: {
          phase_status: phase1.phase_status,
          duration_ms: phase1DurationMs,
          signature: phase1.signature,
          debug: {
            model: phase1.debug.model,
            attempts: phase1.debug.attempts,
            used_fallback: phase1.debug.used_fallback,
            parse_errors: phase1.debug.parse_errors,
            validation_errors: phase1.debug.validation_errors,
          },
        },
        phase2: {
          duration_ms: phase2DurationMs,
          result: phase2.result,
          debug: {
            provider_used: phase2.result.provider_used,
            candidates_considered: phase2.result.candidates_considered,
            warnings: phase2.result.warnings,
          },
        },
        phase3: {
          duration_ms: phase3DurationMs,
          result: phase3.result,
          debug: {
            sources_attempted: phase3.result.sources_attempted,
            sources_used: phase3.result.sources_used,
            paywall_count: phase3.result.paywall_count,
            apify_invocations: phase3.result.apify_invocations,
            warnings: phase3.result.warnings,
          },
        },
        phase4: {
          duration_ms: phase4DurationMs,
          status: phase4.status,
          payload: phase4.payload,
          warnings: phase4.warnings,
          debug: phase4.debug,
        },
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error('[phase1] Smoke test failed:', err);
  process.exit(1);
});
