jest.mock('@/lib/llm', () => ({
  generateJSON: jest.fn(),
  generateText: jest.fn(),
}));

import { generateJSON, generateText } from '@/lib/llm';
import { synthesizeComparativeDossier } from '@/lib/synthesis/phases/synthesize';

const mockedGenerateJSON = generateJSON as jest.MockedFunction<typeof generateJSON>;
const mockedGenerateText = generateText as jest.MockedFunction<typeof generateText>;

const extraction = {
  status: 'ok' as const,
  sources_attempted: 3,
  sources_used: 3,
  paywall_count: 1,
  apify_invocations: 1,
  limited_coverage: false,
  warnings: [],
  extracted_sources: [
    {
      source_id: 1,
      source_name: 'bbc.com',
      source_domain: 'bbc.com',
      headline: 'Source 1',
      url: 'https://bbc.com/a',
      published_at: null,
      content: 'Source 1 content',
      extraction_quality: 'full' as const,
      extraction_method: 'tavily' as const,
      word_count: 100,
      bias_lean: 'center-left' as const,
    },
    {
      source_id: 2,
      source_name: 'apnews.com',
      source_domain: 'apnews.com',
      headline: 'Source 2',
      url: 'https://apnews.com/a',
      published_at: null,
      content: 'Source 2 content',
      extraction_quality: 'full' as const,
      extraction_method: 'tavily' as const,
      word_count: 100,
      bias_lean: 'center' as const,
    },
    {
      source_id: 3,
      source_name: 'cnn.com',
      source_domain: 'cnn.com',
      headline: 'Source 3',
      url: 'https://cnn.com/a',
      published_at: null,
      content: 'Source 3 content',
      extraction_quality: 'paywall_partial' as const,
      extraction_method: 'tavily' as const,
      word_count: 70,
      bias_lean: 'lean-left' as const,
    },
  ],
};

describe('synthesizeComparativeDossier', () => {
  beforeEach(() => {
    mockedGenerateJSON.mockReset();
    mockedGenerateText.mockReset();
  });

  it('returns sanitized structured output when schema is valid but contains one bad entity source id', async () => {
    mockedGenerateJSON.mockResolvedValueOnce({
      ok: true,
      raw: '{"summary":"x"}',
      data: {
        summary: 'Outlets largely agree; Guardian stresses X while peers emphasize Y.',
        agreements: [{ claim: 'Shared claim', source_ids: [0, 2] }],
        differences: [
          {
            topic: 'Editorial emphasis',
            summary: 'Guardian stresses X while peers emphasize Y.',
            source_ids: [0, 2],
          },
        ],
        key_entities: [
          { name: 'Entity', role: 'Actor', source_ids: [0, 3] },
          { name: 'Bad entity', role: 'Actor', source_ids: [100] },
        ],
        open_questions: ['What happens next?'],
        limited_coverage: false,
        metadata: {
          sources_attempted: 3,
          sources_used: 3,
          apify_invocations: 1,
          paywall_count: 1,
        },
      },
    });

    const out = await synthesizeComparativeDossier({
      articleTitle: 'Title',
      articleContent: 'Body',
      extraction,
    });

    expect(out.status).toBe('ok');
    if (!('synthesis_quality' in out.payload)) {
      expect(out.payload.key_entities).toHaveLength(1);
    }
    expect(out.warnings.some((warning) => warning.includes('Dropped key entity'))).toBe(true);
  });

  it('falls back to degraded text when both JSON attempts fail', async () => {
    mockedGenerateJSON
      .mockResolvedValueOnce({
        ok: false,
        raw: 'bad',
        error: 'parse fail',
      })
      .mockResolvedValueOnce({
        ok: false,
        raw: 'still bad',
        error: 'still bad',
      });
    mockedGenerateText.mockResolvedValueOnce('Plain text fallback comparison overview');

    const out = await synthesizeComparativeDossier({
      articleTitle: 'Title',
      articleContent: 'Body',
      extraction,
    });

    expect(out.status).toBe('degraded');
    expect(out.payload).toEqual({
      raw_text: 'Plain text fallback comparison overview',
      synthesis_quality: 'degraded',
    });
  });
});
