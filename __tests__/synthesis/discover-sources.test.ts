jest.mock('@/lib/synthesis/providers/tavily-client', () => ({
  searchTavilyForDiscovery: jest.fn(),
}));

jest.mock('@/lib/synthesis/providers/anthropic-search', () => ({
  searchAnthropicWebForDiscovery: jest.fn(),
}));

import { discoverSources } from '@/lib/synthesis/phases/discover-sources';
import { searchTavilyForDiscovery } from '@/lib/synthesis/providers/tavily-client';
import { searchAnthropicWebForDiscovery } from '@/lib/synthesis/providers/anthropic-search';
import type {
  TavilyDiscoveryCandidate,
  TavilyDiscoveryResult,
} from '@/lib/synthesis/providers/tavily-client';

const mockedTavily = searchTavilyForDiscovery as jest.MockedFunction<typeof searchTavilyForDiscovery>;
const mockedAnthropic = searchAnthropicWebForDiscovery as jest.MockedFunction<typeof searchAnthropicWebForDiscovery>;

const ARTICLE_DATE = '2026-04-28T12:00:00Z';
const eventSnippet = 'Colombia bombing Cauca Actor A Actor B April 2026';

const signature = {
  event_type: 'incident' as const,
  key_actors: ['Actor A', 'Actor B'],
  location: 'Colombia',
  time_window: 'April 2026',
  search_query: 'Colombia bombing Cauca',
  regional_focus: 'south_america' as const,
};

function okTavily(candidates: TavilyDiscoveryCandidate[]): TavilyDiscoveryResult {
  return {
    ok: true,
    timedOut: false,
    error: null,
    request_payload: {},
    raw_response: {},
    candidates,
  };
}

describe('discoverSources', () => {
  beforeEach(() => {
    mockedTavily.mockReset();
    mockedAnthropic.mockReset();
  });

  it('targets preferred tiers, includes regionals, and caps at 6', async () => {
    // Pass 1: tier1 + tier2_open combined (single Tavily call)
    // Pass 2: tier2_paywall
    // Pass 3: regional_south_america
    mockedTavily
      .mockResolvedValueOnce(
        okTavily([
          { headline: 'Reuters 1', url: 'https://www.reuters.com/a', source_domain: 'reuters.com', source_name: 'reuters.com', snippet: eventSnippet, published_at: '2026-04-28T10:00:00Z' },
          { headline: 'AP 1', url: 'https://apnews.com/a', source_domain: 'apnews.com', source_name: 'apnews.com', snippet: eventSnippet, published_at: '2026-04-28T09:00:00Z' },
          { headline: 'BBC 1', url: 'https://www.bbc.com/a', source_domain: 'bbc.com', source_name: 'bbc.com', snippet: eventSnippet, published_at: '2026-04-28T08:00:00Z' },
          { headline: 'CNN 1', url: 'https://www.cnn.com/a', source_domain: 'cnn.com', source_name: 'cnn.com', snippet: eventSnippet, published_at: '2026-04-28T07:00:00Z' },
          { headline: 'Politico 1', url: 'https://www.politico.com/a', source_domain: 'politico.com', source_name: 'politico.com', snippet: eventSnippet, published_at: '2026-04-28T06:00:00Z' },
        ])
      )
      .mockResolvedValueOnce(
        okTavily([
          { headline: 'NYT 1', url: 'https://www.nytimes.com/a', source_domain: 'nytimes.com', source_name: 'nytimes.com', snippet: eventSnippet, published_at: '2026-04-28T05:00:00Z' },
        ])
      )
      .mockResolvedValueOnce(
        okTavily([
          { headline: 'Mercopress 1', url: 'https://www.mercopress.com/a', source_domain: 'mercopress.com', source_name: 'mercopress.com', snippet: eventSnippet, published_at: '2026-04-28T04:00:00Z' },
        ])
      );

    const out = await discoverSources({
      signature,
      articleSourceDomain: 'theguardian.com',
      articlePublishedAt: ARTICLE_DATE,
    });

    expect(out.result.status).toBe('ok');
    expect(out.result.selected_sources).toHaveLength(6);
    expect(out.result.selected_sources.filter((s) => s.tier === 'tier1')).toHaveLength(3);
    expect(out.result.selected_sources.filter((s) => s.tier === 'tier2_open')).toHaveLength(2);
    expect(out.result.selected_sources.filter((s) => s.tier === 'tier3_regional')).toHaveLength(1);
  });

  it('rejects candidates outside the ±7 day publication window', async () => {
    mockedTavily
      .mockResolvedValueOnce(
        okTavily([
          { headline: 'Reuters same event', url: 'https://www.reuters.com/a', source_domain: 'reuters.com', source_name: 'reuters.com', snippet: eventSnippet, published_at: '2026-04-28T10:00:00Z' },
          { headline: 'AP old event same topic', url: 'https://apnews.com/old', source_domain: 'apnews.com', source_name: 'apnews.com', snippet: eventSnippet, published_at: '2025-10-13T10:00:00Z' },
        ])
      )
      .mockResolvedValueOnce(okTavily([]))
      .mockResolvedValueOnce(okTavily([]))
      .mockResolvedValueOnce(okTavily([]))
      .mockResolvedValueOnce(okTavily([]));

    const out = await discoverSources({
      signature,
      articleSourceDomain: 'theguardian.com',
      articlePublishedAt: ARTICLE_DATE,
    });

    expect(out.result.selected_sources).toHaveLength(1);
    expect(out.result.selected_sources[0].source_domain).toBe('reuters.com');
    expect(out.debug.rejected_candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source_domain: 'apnews.com',
          decision: 'outside_publication_window',
        }),
      ])
    );
  });

  it('rejects candidates with explicit year conflict even within publication window', async () => {
    mockedTavily
      .mockResolvedValueOnce(
        okTavily([
          { headline: 'Reuters 2026 event', url: 'https://www.reuters.com/a', source_domain: 'reuters.com', source_name: 'reuters.com', snippet: eventSnippet, published_at: '2026-04-28T10:00:00Z' },
          { headline: 'BBC 2025 attack same actors', url: 'https://www.bbc.com/old-2025', source_domain: 'bbc.com', source_name: 'bbc.com', snippet: 'Colombia bombing Cauca Actor A 2025 attack', published_at: '2026-04-27T10:00:00Z' },
        ])
      )
      .mockResolvedValueOnce(okTavily([]))
      .mockResolvedValueOnce(okTavily([]))
      .mockResolvedValueOnce(okTavily([]))
      .mockResolvedValueOnce(okTavily([]));

    const out = await discoverSources({
      signature,
      articleSourceDomain: 'theguardian.com',
      articlePublishedAt: ARTICLE_DATE,
    });

    expect(out.result.selected_sources).toHaveLength(1);
    expect(out.debug.rejected_candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source_domain: 'bbc.com',
          decision: 'explicit_date_conflict',
        }),
      ])
    );
  });

  it('uses the article publication year over a mistaken extracted time window', async () => {
    mockedTavily
      .mockResolvedValueOnce(
        okTavily([
          { headline: 'Reuters 2026 event', url: 'https://www.reuters.com/a', source_domain: 'reuters.com', source_name: 'reuters.com', snippet: eventSnippet, published_at: '2026-04-28T10:00:00Z' },
          { headline: 'AP 2026 event', url: 'https://apnews.com/a', source_domain: 'apnews.com', source_name: 'apnews.com', snippet: eventSnippet, published_at: '2026-04-28T09:00:00Z' },
        ])
      )
      .mockResolvedValueOnce(okTavily([]))
      .mockResolvedValueOnce(okTavily([]))
      .mockResolvedValueOnce(okTavily([]))
      .mockResolvedValueOnce(okTavily([]));

    const out = await discoverSources({
      signature: {
        ...signature,
        time_window: 'April 2024',
      },
      articleSourceDomain: 'theguardian.com',
      articlePublishedAt: ARTICLE_DATE,
    });

    expect(out.result.selected_sources).toHaveLength(2);
    expect(out.debug.rejected_candidates).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          decision: 'explicit_date_conflict',
        }),
      ])
    );
  });

  it('does not weak-backfill date-rejected candidates', async () => {
    mockedTavily
      .mockResolvedValueOnce(
        okTavily([
          { headline: 'AP old', url: 'https://apnews.com/old', source_domain: 'apnews.com', source_name: 'apnews.com', snippet: eventSnippet, published_at: '2024-03-15T10:00:00Z' },
          { headline: 'Reuters old', url: 'https://reuters.com/old', source_domain: 'reuters.com', source_name: 'reuters.com', snippet: eventSnippet, published_at: '2024-06-20T10:00:00Z' },
        ])
      )
      .mockResolvedValueOnce(okTavily([]))
      .mockResolvedValueOnce(okTavily([]))
      .mockResolvedValueOnce(okTavily([]))
      .mockResolvedValueOnce(okTavily([]));

    const out = await discoverSources({
      signature,
      articleSourceDomain: 'theguardian.com',
      articlePublishedAt: ARTICLE_DATE,
    });

    expect(out.result.selected_sources).toHaveLength(0);
    expect(out.result.status).toBe('limited_coverage');
  });

  it('includes structured rejection metadata in debug for all outcomes', async () => {
    mockedTavily
      .mockResolvedValueOnce(
        okTavily([
          { headline: 'Reuters match', url: 'https://reuters.com/a', source_domain: 'reuters.com', source_name: 'reuters.com', snippet: eventSnippet, published_at: '2026-04-28T10:00:00Z' },
          { headline: 'CNN stale', url: 'https://cnn.com/old', source_domain: 'cnn.com', source_name: 'cnn.com', snippet: eventSnippet, published_at: '2025-01-15T10:00:00Z' },
        ])
      )
      .mockResolvedValueOnce(okTavily([]))
      .mockResolvedValueOnce(okTavily([]))
      .mockResolvedValueOnce(okTavily([]))
      .mockResolvedValueOnce(okTavily([]));

    const out = await discoverSources({
      signature,
      articleSourceDomain: 'theguardian.com',
      articlePublishedAt: ARTICLE_DATE,
    });

    expect(out.debug.article_published_at).toBe(ARTICLE_DATE);
    expect(out.debug.publication_window_days).toBe(7);
    expect(out.debug.accepted_exact_matches).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source_domain: 'reuters.com' }),
      ])
    );
    expect(out.debug.rejected_candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source_domain: 'cnn.com',
          decision: expect.stringMatching(/outside_publication_window/),
        }),
      ])
    );
  });

  it('keeps only one article per outlet family in the final set', async () => {
    mockedTavily
      .mockResolvedValueOnce(
        okTavily([
          { headline: 'BBC 1 same event', url: 'https://www.bbc.com/a', source_domain: 'bbc.com', source_name: 'bbc.com', snippet: eventSnippet, published_at: '2026-04-28T10:00:00Z' },
          { headline: 'BBC 2 same event', url: 'https://www.bbc.co.uk/b', source_domain: 'bbc.co.uk', source_name: 'bbc.co.uk', snippet: eventSnippet, published_at: '2026-04-28T09:00:00Z' },
          { headline: 'Reuters 1', url: 'https://www.reuters.com/a', source_domain: 'reuters.com', source_name: 'reuters.com', snippet: eventSnippet, published_at: '2026-04-28T08:00:00Z' },
        ])
      )
      .mockResolvedValueOnce(
        okTavily([
          { headline: 'Al Jazeera 1', url: 'https://www.aljazeera.com/a', source_domain: 'aljazeera.com', source_name: 'aljazeera.com', snippet: eventSnippet, published_at: '2026-04-28T07:00:00Z' },
        ])
      )
      .mockResolvedValueOnce(okTavily([]))
      .mockResolvedValueOnce(okTavily([]));

    const out = await discoverSources({
      signature,
      articleSourceDomain: 'theguardian.com',
      articlePublishedAt: ARTICLE_DATE,
    });

    expect(out.result.selected_sources.filter((s) => s.source_domain.startsWith('bbc'))).toHaveLength(1);
    expect(out.result.selected_sources.filter((s) => s.source_domain === 'aljazeera.com')).toHaveLength(1);
  });

  it('falls back to anthropic when all tavily passes fail', async () => {
    mockedTavily
      .mockResolvedValue({ ok: false, timedOut: true, error: 'Tavily timeout', request_payload: {}, raw_response: null, candidates: [] });
    mockedAnthropic.mockResolvedValueOnce({
      ok: true,
      error: null,
      raw_response: {},
      candidates: [
        { headline: 'Reuters 1', url: 'https://www.reuters.com/a', source_domain: 'reuters.com', source_name: 'reuters.com', snippet: eventSnippet, published_at: '2026-04-28T10:00:00Z' },
        { headline: 'AP 1', url: 'https://apnews.com/a', source_domain: 'apnews.com', source_name: 'apnews.com', snippet: eventSnippet, published_at: '2026-04-28T09:00:00Z' },
        { headline: 'BBC 1', url: 'https://www.bbc.com/a', source_domain: 'bbc.com', source_name: 'bbc.com', snippet: eventSnippet, published_at: '2026-04-28T08:00:00Z' },
      ],
    });

    const out = await discoverSources({
      signature,
      articleSourceDomain: 'theguardian.com',
      articlePublishedAt: ARTICLE_DATE,
      anthropicFallbackModel: 'claude-sonnet-4-20250514',
    });

    expect(out.result.provider_used).toBe('anthropic_web_search');
    expect(out.result.status).toBe('ok');
    expect(out.result.selected_sources).toHaveLength(3);
  });
});
