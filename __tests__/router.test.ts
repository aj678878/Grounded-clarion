/**
 * Router tests — verify intent + need_web parsing in checkSufficiencyWithDebug.
 * generateJSON is mocked so we can drive the parsed output and assert the
 * normalisation/short-circuit logic in src/lib/gemini.ts.
 */

jest.mock('@/lib/llm', () => ({
  generateJSON: jest.fn(),
  generateText: jest.fn(),
}));

import { generateJSON } from '@/lib/llm';
import { checkSufficiencyWithDebug } from '@/lib/gemini';

const mockedGenerateJSON = generateJSON as jest.MockedFunction<typeof generateJSON>;

function mockRouterReturn(data: Record<string, unknown>, ok = true) {
  mockedGenerateJSON.mockResolvedValueOnce({
    ok,
    data: ok ? data : undefined,
    raw: JSON.stringify(data),
    error: ok ? undefined : 'parse failed',
  });
}

beforeEach(() => {
  mockedGenerateJSON.mockReset();
});

describe('checkSufficiencyWithDebug — intent parsing', () => {
  it('returns intent=answer with need_web=true when router says so', async () => {
    mockRouterReturn({
      intent: 'answer',
      need_web: true,
      reason: 'background needed',
      suggested_queries: ['fed rate cut history'],
      must_cite: true,
    });

    const out = await checkSufficiencyWithDebug('article', 'why does this matter?', []);
    expect(out.result.intent).toBe('answer');
    expect(out.result.need_web).toBe(true);
    expect(out.result.suggested_queries).toEqual(['fed rate cut history']);
    expect(out.result.must_cite).toBe(true);
    expect(out.debug.used_default).toBe(false);
  });

  it('returns intent=answer with need_web=false for analytical questions', async () => {
    mockRouterReturn({
      intent: 'answer',
      need_web: false,
      reason: 'article suffices',
      suggested_queries: [],
      must_cite: false,
    });

    const out = await checkSufficiencyWithDebug('article', 'what does this mean?', []);
    expect(out.result.intent).toBe('answer');
    expect(out.result.need_web).toBe(false);
    expect(out.result.suggested_queries).toEqual([]);
  });

  it('forces need_web/must_cite/queries off when intent=decline_meta', async () => {
    mockRouterReturn({
      intent: 'decline_meta',
      need_web: true,
      reason: 'asking about the model',
      suggested_queries: ['claude vs gpt'],
      must_cite: true,
    });

    const out = await checkSufficiencyWithDebug('article', 'what LLM are you?', []);
    expect(out.result.intent).toBe('decline_meta');
    expect(out.result.need_web).toBe(false);
    expect(out.result.suggested_queries).toEqual([]);
    expect(out.result.must_cite).toBe(false);
  });

  it('forces need_web/must_cite/queries off when intent=decline_off_topic', async () => {
    mockRouterReturn({
      intent: 'decline_off_topic',
      need_web: true,
      reason: 'unrelated to article',
      suggested_queries: ['weather paris'],
      must_cite: true,
    });

    const out = await checkSufficiencyWithDebug('article', "what's the weather in Paris?", []);
    expect(out.result.intent).toBe('decline_off_topic');
    expect(out.result.need_web).toBe(false);
    expect(out.result.suggested_queries).toEqual([]);
    expect(out.result.must_cite).toBe(false);
  });

  it('defaults intent to "answer" when router emits an unknown intent value', async () => {
    mockRouterReturn({
      intent: 'reject',
      need_web: false,
      reason: 'unknown intent',
      suggested_queries: [],
      must_cite: false,
    });

    const out = await checkSufficiencyWithDebug('article', 'q', []);
    expect(out.result.intent).toBe('answer');
  });

  it('falls back to DEFAULT_RESULT when JSON parse fails', async () => {
    mockedGenerateJSON.mockResolvedValueOnce({
      ok: false,
      raw: 'not json',
      error: 'bad json',
    });

    const out = await checkSufficiencyWithDebug('article', 'q', []);
    expect(out.result.intent).toBe('answer');
    expect(out.result.need_web).toBe(false);
    expect(out.debug.used_default).toBe(true);
  });

  it('falls back to DEFAULT_RESULT when need_web is missing/non-boolean', async () => {
    mockRouterReturn({
      intent: 'answer',
      reason: 'forgot need_web',
      suggested_queries: [],
      must_cite: false,
    });

    const out = await checkSufficiencyWithDebug('article', 'q', []);
    expect(out.debug.used_default).toBe(true);
    expect(out.debug.parse_error).toContain('need_web');
  });

  it('coerces non-array suggested_queries to []', async () => {
    mockRouterReturn({
      intent: 'answer',
      need_web: true,
      reason: 'need bg',
      suggested_queries: 'not an array',
      must_cite: true,
    });

    const out = await checkSufficiencyWithDebug('article', 'q', []);
    expect(out.result.suggested_queries).toEqual([]);
  });

  it('truncates long article text in the debug excerpt', async () => {
    mockRouterReturn({
      intent: 'answer',
      need_web: false,
      reason: 'ok',
      suggested_queries: [],
      must_cite: false,
    });

    const longArticle = 'x'.repeat(5_000);
    const out = await checkSufficiencyWithDebug(longArticle, 'q', []);
    expect(out.debug.article_excerpt_used.length).toBeLessThanOrEqual(3_100);
    expect(out.debug.article_excerpt_used).toContain('article truncated');
  });

  it('returns DEFAULT_RESULT when generateJSON throws', async () => {
    mockedGenerateJSON.mockRejectedValueOnce(new Error('boom'));

    const out = await checkSufficiencyWithDebug('article', 'q', []);
    expect(out.result.intent).toBe('answer');
    expect(out.debug.used_default).toBe(true);
    expect(out.debug.parse_error).toContain('boom');
  });
});
