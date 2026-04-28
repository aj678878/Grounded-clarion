jest.mock('@/lib/llm', () => ({
  generateJSON: jest.fn(),
}));

import { generateJSON } from '@/lib/llm';
import { extractEventSignature } from '@/lib/synthesis/phases/extract-event';

const mockedGenerateJSON = generateJSON as jest.MockedFunction<typeof generateJSON>;

describe('extractEventSignature', () => {
  beforeEach(() => {
    mockedGenerateJSON.mockReset();
  });

  it('returns a validated event signature on first pass', async () => {
    mockedGenerateJSON.mockResolvedValueOnce({
      ok: true,
      raw: '{"event_type":"geopolitical"}',
      data: {
        event_type: 'geopolitical',
        key_actors: ['Colombian government', 'FARC dissidents'],
        location: 'Cauca, Colombia',
        time_window: 'late April 2026',
        search_query: 'Colombia Cauca highway bombing',
        regional_focus: 'south_america',
      },
    });

    const result = await extractEventSignature({
      articleTitle: 'Bomb on Pan-American highway in Colombia',
      articleContent: 'Word '.repeat(800),
    });

    expect(result.phase_status).toBe('ok');
    expect(result.signature.search_query).toBe('Colombia Cauca highway bombing');
    expect(result.debug.used_fallback).toBe(false);
    expect(result.debug.attempts).toBe(1);
  });

  it('retries once when schema validation fails and succeeds on strict retry', async () => {
    mockedGenerateJSON
      .mockResolvedValueOnce({
        ok: true,
        raw: '{"event_type":"incident"}',
        data: {
          event_type: 'incident',
          key_actors: ['Only one actor'],
          location: 'Bogota',
          time_window: '',
          search_query: 'bad',
          regional_focus: null,
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        raw: '{"event_type":"incident","key_actors":["A","B"]}',
        data: {
          event_type: 'incident',
          key_actors: ['Colombian police', 'FARC dissidents'],
          location: 'Colombia',
          time_window: 'April 2026',
          search_query: 'Colombia rebel attack',
          regional_focus: 'south_america',
        },
      });

    const result = await extractEventSignature({
      articleTitle: 'Colombia rebel attack',
      articleContent: 'Example content',
    });

    expect(result.phase_status).toBe('ok');
    expect(result.signature.event_type).toBe('incident');
    expect(result.debug.attempts).toBe(2);
    expect(result.debug.validation_errors.length).toBe(1);
  });

  it('falls back when both attempts fail', async () => {
    mockedGenerateJSON
      .mockResolvedValueOnce({
        ok: false,
        raw: 'not json',
        error: 'parse failed',
      })
      .mockResolvedValueOnce({
        ok: true,
        raw: '{"event_type":"other"}',
        data: {
          event_type: 'other',
          key_actors: [],
          location: null,
          time_window: '',
          search_query: '',
          regional_focus: null,
        },
      });

    const result = await extractEventSignature({
      articleTitle: 'North Korea report',
      articleContent: 'Example content',
    });

    expect(result.phase_status).toBe('degraded_fallback');
    expect(result.signature.event_type).toBe('other');
    expect(result.signature.search_query).toBe('North Korea report');
    expect(result.debug.used_fallback).toBe(true);
    expect(result.debug.attempts).toBe(2);
  });
});
