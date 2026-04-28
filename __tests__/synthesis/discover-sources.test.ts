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
    mockedTavily
      .mockResolvedValueOnce(
        okTavily([
          { headline: 'Reuters 1', url: 'https://www.reuters.com/a', source_domain: 'reuters.com', source_name: 'reuters.com', snippet: '', published_at: '2026-04-28T10:00:00Z' },
          { headline: 'AP 1', url: 'https://apnews.com/a', source_domain: 'apnews.com', source_name: 'apnews.com', snippet: '', published_at: '2026-04-28T09:00:00Z' },
          { headline: 'BBC 1', url: 'https://www.bbc.com/a', source_domain: 'bbc.com', source_name: 'bbc.com', snippet: '', published_at: '2026-04-28T08:00:00Z' },
        ])
      )
      .mockResolvedValueOnce(
        okTavily([
          { headline: 'CNN 1', url: 'https://www.cnn.com/a', source_domain: 'cnn.com', source_name: 'cnn.com', snippet: '', published_at: '2026-04-28T07:00:00Z' },
          { headline: 'Politico 1', url: 'https://www.politico.com/a', source_domain: 'politico.com', source_name: 'politico.com', snippet: '', published_at: '2026-04-28T06:00:00Z' },
        ])
      )
      .mockResolvedValueOnce(
        okTavily([
          { headline: 'NYT 1', url: 'https://www.nytimes.com/a', source_domain: 'nytimes.com', source_name: 'nytimes.com', snippet: '', published_at: '2026-04-28T05:00:00Z' },
        ])
      )
      .mockResolvedValueOnce(
        okTavily([
          { headline: 'Mercopress 1', url: 'https://www.mercopress.com/a', source_domain: 'mercopress.com', source_name: 'mercopress.com', snippet: 'Colombia bombing Cauca Actor A Actor B April 2026', published_at: '2026-04-28T04:00:00Z' },
        ])
      );

    const out = await discoverSources({
      signature,
      articleSourceDomain: 'theguardian.com',
    });

    expect(out.result.status).toBe('ok');
    expect(out.result.selected_sources).toHaveLength(6);
    expect(out.result.selected_sources.filter((s) => s.tier === 'tier1')).toHaveLength(3);
    expect(out.result.selected_sources.filter((s) => s.tier === 'tier2_open')).toHaveLength(2);
    expect(out.result.selected_sources.filter((s) => s.tier === 'tier3_regional')).toHaveLength(1);
    expect(out.result.selected_sources.filter((s) => s.tier === 'tier2_paywall')).toHaveLength(0);
    expect(mockedTavily).toHaveBeenCalledTimes(4);
    expect(mockedTavily.mock.calls[0][0]).toMatchObject({ includeDomains: expect.arrayContaining(['reuters.com', 'apnews.com']) });
    expect(mockedTavily.mock.calls[3][0]).toMatchObject({ includeDomains: ['mercopress.com'] });
  });

  it('backfills from broad tavily search when targeted passes are sparse', async () => {
    mockedTavily
      .mockResolvedValueOnce(
        okTavily([
          { headline: 'AP 1', url: 'https://apnews.com/a', source_domain: 'apnews.com', source_name: 'apnews.com', snippet: '', published_at: null },
        ])
      )
      .mockResolvedValueOnce(okTavily([]))
      .mockResolvedValueOnce(okTavily([]))
      .mockResolvedValueOnce(okTavily([]))
      .mockResolvedValueOnce(
        okTavily([
          { headline: 'Unranked 1', url: 'https://example.com/a', source_domain: 'example.com', source_name: 'example.com', snippet: '', published_at: null },
          { headline: 'Unranked 2', url: 'https://example.org/b', source_domain: 'example.org', source_name: 'example.org', snippet: '', published_at: null },
        ])
      );

    const out = await discoverSources({
      signature,
      articleSourceDomain: 'theguardian.com',
    });

    expect(out.result.status).toBe('ok');
    expect(out.result.selected_sources).toHaveLength(3);
    expect(out.result.selected_sources.some((s) => s.source_domain === 'example.com')).toBe(true);
    expect(mockedTavily).toHaveBeenCalledTimes(5);
    expect(mockedTavily.mock.calls[4][0]).toMatchObject({ maxResults: 10 });
  });

  it('keeps only one article per outlet family in the final set', async () => {
    mockedTavily
      .mockResolvedValueOnce(
        okTavily([
          { headline: 'BBC 1 same event', url: 'https://www.bbc.com/a', source_domain: 'bbc.com', source_name: 'bbc.com', snippet: 'Colombia bombing Cauca Actor A', published_at: '2026-04-28T10:00:00Z' },
          { headline: 'BBC 2 same event', url: 'https://www.bbc.co.uk/b', source_domain: 'bbc.co.uk', source_name: 'bbc.co.uk', snippet: 'Colombia bombing Cauca Actor B', published_at: '2026-04-28T09:00:00Z' },
          { headline: 'Reuters 1', url: 'https://www.reuters.com/a', source_domain: 'reuters.com', source_name: 'reuters.com', snippet: 'Colombia bombing Cauca Actor A', published_at: '2026-04-28T08:00:00Z' },
        ])
      )
      .mockResolvedValueOnce(
        okTavily([
          { headline: 'Al Jazeera 1', url: 'https://www.aljazeera.com/a', source_domain: 'aljazeera.com', source_name: 'aljazeera.com', snippet: 'Colombia bombing Cauca Actor B', published_at: '2026-04-28T07:00:00Z' },
          { headline: 'Al Jazeera 2', url: 'https://www.aljazeera.com/b', source_domain: 'aljazeera.com', source_name: 'aljazeera.com', snippet: 'Colombia bombing Cauca Actor A', published_at: '2026-04-28T06:00:00Z' },
        ])
      )
      .mockResolvedValueOnce(okTavily([]))
      .mockResolvedValueOnce(okTavily([]));

    const out = await discoverSources({
      signature,
      articleSourceDomain: 'theguardian.com',
    });

    expect(out.result.selected_sources.filter((s) => s.source_domain.startsWith('bbc'))).toHaveLength(1);
    expect(out.result.selected_sources.filter((s) => s.source_domain === 'aljazeera.com')).toHaveLength(1);
  });

  it('filters weak same-topic mismatches when stronger same-event candidates exist', async () => {
    mockedTavily
      .mockResolvedValueOnce(
        okTavily([
          { headline: 'AP same event', url: 'https://apnews.com/a', source_domain: 'apnews.com', source_name: 'apnews.com', snippet: 'United Arab Emirates quits OPEC oil cartel Actor A', published_at: '2026-04-28T10:00:00Z' },
          { headline: 'BBC same event', url: 'https://www.bbc.com/a', source_domain: 'bbc.com', source_name: 'bbc.com', snippet: 'United Arab Emirates quits OPEC oil cartel', published_at: '2026-04-28T09:00:00Z' },
        ])
      )
      .mockResolvedValueOnce(
        okTavily([
          { headline: 'CNN same event', url: 'https://www.cnn.com/a', source_domain: 'cnn.com', source_name: 'cnn.com', snippet: 'United Arab Emirates quits OPEC oil cartel', published_at: '2026-04-28T08:00:00Z' },
        ])
      )
      .mockResolvedValueOnce(
        okTavily([
          { headline: 'FT same event', url: 'https://www.ft.com/a', source_domain: 'ft.com', source_name: 'ft.com', snippet: 'United Arab Emirates quits OPEC oil cartel', published_at: '2026-04-28T07:00:00Z' },
        ])
      )
      .mockResolvedValueOnce(
        okTavily([
          { headline: "Qatar's exit from OPEC will have no major impact on oil prices", url: 'https://www.arabnews.com/qatar', source_domain: 'arabnews.com', source_name: 'arabnews.com', snippet: 'Qatar OPEC oil prices', published_at: '2026-04-28T06:00:00Z' },
        ])
      );

    const out = await discoverSources({
      signature: {
        ...signature,
        search_query: 'UAE quits OPEC oil cartel',
        key_actors: ['United Arab Emirates', 'OPEC', 'Saudi Arabia'],
        location: 'Middle East',
        regional_focus: 'middle_east',
      },
      articleSourceDomain: 'theguardian.com',
    });

    expect(out.result.selected_sources.some((s) => s.url.includes('/qatar'))).toBe(false);
    expect(out.result.selected_sources).toHaveLength(4);
  });

  it('falls back to anthropic when all tavily passes fail to produce candidates', async () => {
    mockedTavily
      .mockResolvedValueOnce({ ok: false, timedOut: true, error: 'Tavily timeout', request_payload: {}, raw_response: null, candidates: [] })
      .mockResolvedValueOnce({ ok: false, timedOut: false, error: 'Tier2 fail', request_payload: {}, raw_response: null, candidates: [] })
      .mockResolvedValueOnce({ ok: false, timedOut: false, error: 'Tier2 paywall fail', request_payload: {}, raw_response: null, candidates: [] })
      .mockResolvedValueOnce({ ok: false, timedOut: false, error: 'Regional fail', request_payload: {}, raw_response: null, candidates: [] })
      .mockResolvedValueOnce({ ok: false, timedOut: true, error: 'Broad fail', request_payload: {}, raw_response: null, candidates: [] });
    mockedAnthropic.mockResolvedValueOnce({
      ok: true,
      error: null,
      raw_response: {},
      candidates: [
        { headline: 'Reuters 1', url: 'https://www.reuters.com/a', source_domain: 'reuters.com', source_name: 'reuters.com', snippet: '', published_at: null },
        { headline: 'AP 1', url: 'https://apnews.com/a', source_domain: 'apnews.com', source_name: 'apnews.com', snippet: '', published_at: null },
        { headline: 'BBC 1', url: 'https://www.bbc.com/a', source_domain: 'bbc.com', source_name: 'bbc.com', snippet: '', published_at: null },
      ],
    });

    const out = await discoverSources({
      signature,
      articleSourceDomain: 'theguardian.com',
      anthropicFallbackModel: 'claude-sonnet-4-20250514',
    });

    expect(out.result.provider_used).toBe('anthropic_web_search');
    expect(out.result.status).toBe('ok');
    expect(out.result.selected_sources).toHaveLength(3);
    expect(mockedAnthropic).toHaveBeenCalled();
  });

  it('applies bias rebalance when the selected set is heavily left-leaning', async () => {
    mockedTavily
      .mockResolvedValueOnce(
        okTavily([
          { headline: 'BBC 1', url: 'https://www.bbc.com/a', source_domain: 'bbc.com', source_name: 'bbc.com', snippet: '', published_at: '2026-04-28T10:00:00Z' },
          { headline: 'BBC 2', url: 'https://www.bbc.com/b', source_domain: 'bbc.com', source_name: 'bbc.com', snippet: '', published_at: '2026-04-28T09:00:00Z' },
          { headline: 'BBC 3', url: 'https://www.bbc.com/c', source_domain: 'bbc.com', source_name: 'bbc.com', snippet: '', published_at: '2026-04-28T08:30:00Z' },
        ])
      )
      .mockResolvedValueOnce(
        okTavily([
          { headline: 'CNN 1', url: 'https://www.cnn.com/a', source_domain: 'cnn.com', source_name: 'cnn.com', snippet: '', published_at: '2026-04-28T08:00:00Z' },
          { headline: 'NPR 1', url: 'https://www.npr.org/a', source_domain: 'npr.org', source_name: 'npr.org', snippet: '', published_at: '2026-04-28T07:00:00Z' },
        ])
      )
      .mockResolvedValueOnce(
        okTavily([
          { headline: 'FT 1', url: 'https://www.ft.com/a', source_domain: 'ft.com', source_name: 'ft.com', snippet: '', published_at: '2026-04-28T06:00:00Z' },
          { headline: 'Economist 1', url: 'https://www.economist.com/a', source_domain: 'economist.com', source_name: 'economist.com', snippet: '', published_at: '2026-04-28T05:30:00Z' },
        ])
      )
      .mockResolvedValueOnce(okTavily([]));

    const out = await discoverSources({
      signature,
      articleSourceDomain: 'apnews.com',
    });

    expect(out.result.selected_sources.some((s) => s.source_domain === 'ft.com')).toBe(true);
    expect(out.result.bias_diversity_warning).toBe(false);
  });
});
