import { getBiasLean } from '../source-tiers';
import { extractTavilyContent } from '../providers/tavily-client';
import { extractWithApify } from '../providers/apify-client';
import { countWords, isPaywalled } from '../paywall-detector';
import type {
  ContentExtractionResult,
  DiscoveredSource,
  ExtractedSource,
  ExtractionMethod,
  ExtractionQuality,
  EventSignature,
} from '../schema';
import { contentExtractionResultSchema } from '../schema';

// Only domains that actually have hard paywalls and are supported by Apify extractor.
// wired.com and npr.org removed (open-access). wsj.com, ft.com, economist.com added (hard paywalls).
const APIFY_SUPPORTED_DOMAINS = new Set([
  'nytimes.com',
  'washingtonpost.com',
  'bloomberg.com',
  'wsj.com',
  'ft.com',
  'economist.com',
  'cnbc.com',
]);

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function isApifySupported(domain: string): boolean {
  return APIFY_SUPPORTED_DOMAINS.has(domain);
}

function qualityFromTavilyContent(content: string, headline: string): ExtractionQuality {
  if (!content.trim()) return 'failed';
  if (isPaywalled(content, headline)) {
    return content.trim().length >= 400 ? 'paywall_partial' : 'snippet_only';
  }
  return 'full';
}

function buildExtractedSource(
  source: DiscoveredSource,
  content: string,
  extraction_quality: ExtractionQuality,
  extraction_method: ExtractionMethod
): ExtractedSource {
  const normalized = normalizeWhitespace(content);
  return {
    source_id: source.source_id,
    source_name: source.source_name,
    source_domain: source.source_domain,
    headline: source.headline,
    url: source.url,
    published_at: source.published_at,
    content: normalized,
    extraction_quality,
    extraction_method,
    word_count: countWords(normalized),
    bias_lean: getBiasLean(source.source_domain),
  };
}

export async function extractSourceContent(input: {
  sources: DiscoveredSource[];
  signature: EventSignature;
}): Promise<{
  result: ContentExtractionResult;
  debug: Record<string, unknown>;
}> {
  const warnings: string[] = [];
  const urls = input.sources.map((source) => source.url);

  const tavily = await extractTavilyContent({
    urls,
    query: input.signature.search_query,
    timeoutSeconds: 10,
  });

  const tavilyByUrl = new Map(tavily.results.map((row) => [row.url, normalizeWhitespace(row.raw_content)]));
  const tavilyFailedByUrl = new Map(tavily.failed_results.map((row) => [row.url, row.error]));

  let paywallCount = 0;
  let apifyInvocations = 0;

  const perSource = await Promise.all(
    input.sources.map(async (source) => {
      const tavilyContent = tavilyByUrl.get(source.url) ?? '';
      const initialQuality = qualityFromTavilyContent(tavilyContent, source.headline);
      const needsApify =
        isApifySupported(source.source_domain) &&
        (initialQuality === 'snippet_only' || initialQuality === 'paywall_partial' || initialQuality === 'failed');

      if (initialQuality === 'snippet_only' || initialQuality === 'paywall_partial') {
        paywallCount += 1;
      }

      if (needsApify) {
        apifyInvocations += 1;
        const apify = await extractWithApify({
          url: source.url,
          sourceDomain: source.source_domain,
          headline: source.headline,
          query: input.signature.search_query,
        });

        if (apify.ok && apify.content.trim()) {
          return {
            extracted: buildExtractedSource(source, apify.content, 'apify_full', 'apify'),
            debug: {
              source_id: source.source_id,
              url: source.url,
              tavily_quality: initialQuality,
              apify_used: true,
              apify_ok: true,
              apify_item_count: apify.item_count,
            },
          };
        }

        const fallbackSnippet = source.snippet || tavilyContent;
        if (fallbackSnippet.trim()) {
          return {
            extracted: buildExtractedSource(source, fallbackSnippet, 'snippet_only', 'snippet_fallback'),
            debug: {
              source_id: source.source_id,
              url: source.url,
              tavily_quality: initialQuality,
              apify_used: true,
              apify_ok: false,
              apify_error: apify.error,
            },
          };
        }
      }

      if (initialQuality === 'full' || initialQuality === 'paywall_partial') {
        return {
          extracted: buildExtractedSource(source, tavilyContent, initialQuality, 'tavily'),
          debug: {
            source_id: source.source_id,
            url: source.url,
            tavily_quality: initialQuality,
            apify_used: false,
          },
        };
      }

      const fallbackSnippet = source.snippet;
      if (fallbackSnippet.trim()) {
        return {
          extracted: buildExtractedSource(source, fallbackSnippet, 'snippet_only', 'snippet_fallback'),
          debug: {
            source_id: source.source_id,
            url: source.url,
            tavily_quality: initialQuality,
            apify_used: false,
            tavily_failure: tavilyFailedByUrl.get(source.url) ?? null,
          },
        };
      }

      return {
        extracted: buildExtractedSource(source, '', 'failed', 'snippet_fallback'),
        debug: {
          source_id: source.source_id,
          url: source.url,
          tavily_quality: initialQuality,
          apify_used: false,
          tavily_failure: tavilyFailedByUrl.get(source.url) ?? null,
        },
      };
    })
  );

  const extracted_sources = perSource
    .map((row) => row.extracted)
    .filter((source) => source.extraction_quality !== 'failed' && source.content.trim().length > 0);

  const usableCount = extracted_sources.filter(
    (source) => source.extraction_quality !== 'failed'
  ).length;
  const strongCount = extracted_sources.filter((source) =>
    source.extraction_quality === 'full' || source.extraction_quality === 'apify_full'
  ).length;
  const limitedCoverage = strongCount < 3;

  if (usableCount < 2) {
    warnings.push('Content extraction failed: fewer than 2 usable sources remained');
    const errorResult: ContentExtractionResult = {
      status: 'error',
      error_phase: 'content_extraction',
      sources_attempted: input.sources.length,
      sources_used: usableCount,
      paywall_count: paywallCount,
      apify_invocations: apifyInvocations,
      limited_coverage: true,
      extracted_sources,
      warnings,
    };
    return {
      result: contentExtractionResultSchema.parse(errorResult),
      debug: {
        tavily_extract: tavily,
        per_source: perSource.map((row) => row.debug),
      },
    };
  }

  if (limitedCoverage) {
    warnings.push('Limited coverage: fewer than 3 full-content sources extracted');
  }

  const result: ContentExtractionResult = {
    status: limitedCoverage ? 'limited_coverage' : 'ok',
    sources_attempted: input.sources.length,
    sources_used: usableCount,
    paywall_count: paywallCount,
    apify_invocations: apifyInvocations,
    limited_coverage: limitedCoverage,
    extracted_sources,
    warnings,
  };

  return {
    result: contentExtractionResultSchema.parse(result),
    debug: {
      tavily_extract: tavily,
      per_source: perSource.map((row) => row.debug),
    },
  };
}
