jest.mock('@/lib/synthesis/providers/tavily-client', () => ({
  extractTavilyContent: jest.fn(),
}));

jest.mock('@/lib/synthesis/providers/apify-client', () => ({
  extractWithApify: jest.fn(),
}));

import { extractSourceContent } from '@/lib/synthesis/phases/extract-content';
import { extractTavilyContent } from '@/lib/synthesis/providers/tavily-client';
import { extractWithApify } from '@/lib/synthesis/providers/apify-client';

const mockedTavilyExtract = extractTavilyContent as jest.MockedFunction<typeof extractTavilyContent>;
const mockedApify = extractWithApify as jest.MockedFunction<typeof extractWithApify>;

const signature = {
  event_type: 'incident' as const,
  key_actors: ['Actor A', 'Actor B'],
  location: 'Colombia',
  time_window: 'April 2026',
  search_query: 'Colombia bombing Cauca',
  regional_focus: 'south_america' as const,
};

const sources = [
  {
    source_id: 1,
    source_name: 'apnews.com',
    source_domain: 'apnews.com',
    headline: 'AP same event',
    url: 'https://apnews.com/a',
    published_at: null,
    snippet: 'AP fallback snippet',
    tier: 'tier1' as const,
    bias_lean: 'center' as const,
  },
  {
    source_id: 2,
    source_name: 'washingtonpost.com',
    source_domain: 'washingtonpost.com',
    headline: 'WaPo same event',
    url: 'https://www.washingtonpost.com/a',
    published_at: null,
    snippet: 'WaPo fallback snippet',
    tier: 'tier2_paywall' as const,
    bias_lean: 'lean-left' as const,
  },
];

describe('extractSourceContent', () => {
  beforeEach(() => {
    mockedTavilyExtract.mockReset();
    mockedApify.mockReset();
  });

  it('keeps full Tavily extracts when content is healthy', async () => {
    mockedTavilyExtract.mockResolvedValueOnce({
      ok: true,
      timedOut: false,
      error: null,
      request_payload: {},
      raw_response: {},
      failed_results: [],
      results: [
        {
          url: sources[0].url,
          raw_content:
            'This is a full AP article body with enough detail to pass the extractor and avoid paywall heuristics entirely. It includes several sentences about the event, the actors involved, and the timeline so the quality gate treats it as a real extract rather than a thin teaser or snippet.',
        },
        {
          url: sources[1].url,
          raw_content:
            'This is a full Washington Post article body with enough detail to pass the extractor and avoid paywall heuristics entirely. It includes several additional sentences discussing the event details, market impact, quoted officials, and the immediate consequences so the extraction is clearly substantial.',
        },
      ],
    });

    const out = await extractSourceContent({ sources, signature });

    expect(out.result.status).toBe('limited_coverage');
    expect(out.result.extracted_sources).toHaveLength(2);
    expect(out.result.extracted_sources.every((source) => source.extraction_method === 'tavily')).toBe(true);
    expect(out.result.apify_invocations).toBe(0);
  });

  it('uses Apify when Tavily extract is paywalled for a supported domain', async () => {
    mockedTavilyExtract.mockResolvedValueOnce({
      ok: true,
      timedOut: false,
      error: null,
      request_payload: {},
      raw_response: {},
      failed_results: [],
      results: [
        { url: sources[0].url, raw_content: 'This is a full AP article body with enough detail to pass the extractor and avoid paywall heuristics entirely.' },
        { url: sources[1].url, raw_content: 'Democracy Dies in Darkness. Subscribe to continue reading this story.' },
      ],
    });
    mockedApify.mockResolvedValueOnce({
      ok: true,
      error: null,
      raw_response: {},
      content: 'This is the full rescued Washington Post article text pulled from Apify with enough detail to be useful.',
      headline: 'WaPo same event',
      url: sources[1].url,
      item_count: 1,
    });

    const out = await extractSourceContent({ sources, signature });

    expect(out.result.extracted_sources.find((source) => source.source_domain === 'washingtonpost.com')?.extraction_method).toBe('apify');
    expect(out.result.extracted_sources.find((source) => source.source_domain === 'washingtonpost.com')?.extraction_quality).toBe('apify_full');
    expect(out.result.apify_invocations).toBe(1);
  });

  it('falls back to snippet and errors when fewer than 2 usable sources remain', async () => {
    mockedTavilyExtract.mockResolvedValueOnce({
      ok: true,
      timedOut: false,
      error: null,
      request_payload: {},
      raw_response: {},
      failed_results: [{ url: sources[0].url, error: 'timeout' }],
      results: [{ url: sources[1].url, raw_content: '' }],
    });
    mockedApify.mockResolvedValueOnce({
      ok: false,
      error: 'Apify timeout',
      raw_response: null,
      content: '',
      headline: '',
      url: sources[1].url,
      item_count: 0,
    });

    const out = await extractSourceContent({
      sources: [
        { ...sources[0], snippet: '' },
        { ...sources[1], snippet: '' },
      ],
      signature,
    });

    expect(out.result.status).toBe('error');
    expect(out.result.error_phase).toBe('content_extraction');
    expect(out.result.sources_used).toBe(0);
  });
});
