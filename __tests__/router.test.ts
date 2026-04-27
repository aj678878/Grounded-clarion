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
      article_evidence_summary: 'The article covers the rate cut but not the historical comparison.',
      would_require_speculation: true,
    });

    const out = await checkSufficiencyWithDebug('article', 'why does this matter?', []);
    expect(out.result.intent).toBe('answer');
    expect(out.result.need_web).toBe(true);
    expect(out.result.suggested_queries).toEqual(['fed rate cut history']);
    expect(out.result.must_cite).toBe(true);
    expect(out.result.article_evidence_summary).toContain('rate cut');
    expect(out.result.would_require_speculation).toBe(true);
    expect(out.debug.used_default).toBe(false);
  });

  it('returns intent=answer with need_web=false when article evidence is sufficient', async () => {
    mockRouterReturn({
      intent: 'answer',
      need_web: false,
      reason: 'article suffices',
      suggested_queries: [],
      must_cite: false,
      article_evidence_summary: 'The article explains the policy move and its likely market effects.',
      would_require_speculation: false,
    });

    const out = await checkSufficiencyWithDebug('article', 'what does this mean?', []);
    expect(out.result.intent).toBe('answer');
    expect(out.result.need_web).toBe(false);
    expect(out.result.suggested_queries).toEqual([]);
    expect(out.result.article_evidence_summary).toContain('market effects');
    expect(out.result.would_require_speculation).toBe(false);
  });

  it('forces need_web/must_cite/queries off when intent=decline_meta', async () => {
    mockRouterReturn({
      intent: 'decline_meta',
      need_web: true,
      reason: 'asking about the model',
      suggested_queries: ['claude vs gpt'],
      must_cite: true,
      article_evidence_summary: 'Not relevant.',
      would_require_speculation: true,
    });

    const out = await checkSufficiencyWithDebug('article', 'what LLM are you?', []);
    expect(out.result.intent).toBe('decline_meta');
    expect(out.result.need_web).toBe(false);
    expect(out.result.suggested_queries).toEqual([]);
    expect(out.result.must_cite).toBe(false);
    expect(out.result.would_require_speculation).toBe(false);
  });

  it('forces need_web/must_cite/queries off when intent=decline_off_topic', async () => {
    mockRouterReturn({
      intent: 'decline_off_topic',
      need_web: true,
      reason: 'unrelated to article',
      suggested_queries: ['weather paris'],
      must_cite: true,
      article_evidence_summary: 'Not relevant.',
      would_require_speculation: true,
    });

    const out = await checkSufficiencyWithDebug('article', "what's the weather in Paris?", []);
    expect(out.result.intent).toBe('decline_off_topic');
    expect(out.result.need_web).toBe(false);
    expect(out.result.suggested_queries).toEqual([]);
    expect(out.result.must_cite).toBe(false);
    expect(out.result.would_require_speculation).toBe(false);
  });

  it('defaults intent to "answer" when router emits an unknown intent value', async () => {
    mockRouterReturn({
      intent: 'reject',
      need_web: false,
      reason: 'unknown intent',
      suggested_queries: [],
      must_cite: false,
      article_evidence_summary: '',
      would_require_speculation: false,
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
      article_evidence_summary: 'The article identifies the event but not the missing background.',
      would_require_speculation: true,
    });

    const out = await checkSufficiencyWithDebug('article', 'q', []);
    expect(out.result.suggested_queries).toEqual([]);
  });

  it('defaults evidence summary and speculation flag when those fields are missing', async () => {
    mockRouterReturn({
      intent: 'answer',
      need_web: true,
      reason: 'missing context',
      suggested_queries: ['entity background'],
      must_cite: true,
    });

    const out = await checkSufficiencyWithDebug('article', 'q', []);
    expect(out.result.article_evidence_summary).toBe('');
    expect(out.result.would_require_speculation).toBe(false);
  });

  it('supports a representative under-supported motive question requiring web search', async () => {
    mockRouterReturn({
      intent: 'answer',
      need_web: true,
      reason: 'The article describes the attack but not the rebels’ tactical motive.',
      suggested_queries: ['Colombia rebel highway bombing motive'],
      must_cite: true,
      article_evidence_summary: 'The article identifies the group, region, and election timing but does not explain the highway as a tactical target.',
      would_require_speculation: true,
    });

    const out = await checkSufficiencyWithDebug(
      'article text about an attack and elections',
      'Why would the rebels bomb a highway though?',
      []
    );
    expect(out.result.need_web).toBe(true);
    expect(out.result.would_require_speculation).toBe(true);
  });

  it('supports a representative interpretation question where the article evidence is enough', async () => {
    mockRouterReturn({
      intent: 'answer',
      need_web: false,
      reason: 'The article already lays out the policy change and its stated consequences.',
      suggested_queries: [],
      must_cite: false,
      article_evidence_summary: 'The article explains the policy move, affected sectors, and expected consequences.',
      would_require_speculation: false,
    });

    const out = await checkSufficiencyWithDebug(
      'article text about a policy move and expected effects',
      'What does this suggest about the government’s priorities?',
      []
    );
    expect(out.result.need_web).toBe(false);
    expect(out.result.would_require_speculation).toBe(false);
  });

  it('supports a representative interpretation question where the article evidence is not enough', async () => {
    mockRouterReturn({
      intent: 'answer',
      need_web: true,
      reason: 'The article reports the event but lacks enough historical and strategic context for a confident interpretation.',
      suggested_queries: ['topic historical context significance'],
      must_cite: true,
      article_evidence_summary: 'The article covers the immediate event but not the broader historical significance.',
      would_require_speculation: true,
    });

    const out = await checkSufficiencyWithDebug(
      'article text about a sudden diplomatic event',
      'What does this suggest about the region’s long-term strategic alignment?',
      []
    );
    expect(out.result.need_web).toBe(true);
    expect(out.result.would_require_speculation).toBe(true);
  });

  it('truncates long article text in the debug excerpt', async () => {
    mockRouterReturn({
      intent: 'answer',
      need_web: false,
      reason: 'ok',
      suggested_queries: [],
      must_cite: false,
      article_evidence_summary: 'The visible article excerpt is enough.',
      would_require_speculation: false,
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
