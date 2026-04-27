jest.mock('@/lib/env', () => ({
  getGuardianApiKey: jest.fn(() => 'test-key'),
  getGuardianBaseUrl: jest.fn(() => 'https://content.guardian.test'),
}));

import { fetchBalancedFeed, searchFeed } from '@/lib/guardian';

describe('guardian feed mapping', () => {
  const fetchMock = jest.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  it('maps feed bylines and thumbnails from Guardian results', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          response: {
            results: [
              {
                id: 'world/1',
                webTitle: 'World story',
                webPublicationDate: '2026-04-27T10:00:00Z',
                sectionName: 'World news',
                sectionId: 'world',
                webUrl: 'https://www.theguardian.com/world/1',
                fields: {
                  trailText: 'World trail',
                  thumbnail: 'https://media.guardian.example/world.jpg',
                  byline: 'Jane Reporter',
                },
              },
            ],
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ response: { results: [] } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ response: { results: [] } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ response: { results: [] } }),
      });

    const articles = await fetchBalancedFeed(1);

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock.mock.calls[0][0]).toContain('show-fields=trailText,thumbnail,byline');
    expect(articles[0]).toMatchObject({
      id: 'world/1',
      category: 'Business',
      thumbnail: 'https://media.guardian.example/world.jpg',
      byline: 'Jane Reporter',
    });
  });

  it('handles missing feed byline and thumbnail without breaking search results', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        response: {
          results: [
            {
              id: 'search/1',
              webTitle: 'Search story',
              webPublicationDate: '2026-04-27T12:00:00Z',
              sectionName: 'Technology',
              sectionId: 'technology',
              webUrl: 'https://www.theguardian.com/technology/1',
              fields: {
                trailText: 'Search trail',
              },
            },
          ],
        },
      }),
    });

    const articles = await searchFeed('technology', 1);

    expect(fetchMock.mock.calls[0][0]).toContain('show-fields=trailText,thumbnail,byline');
    expect(articles[0]).toMatchObject({
      id: 'search/1',
      category: 'Search',
      thumbnail: '',
      byline: '',
    });
  });
});
