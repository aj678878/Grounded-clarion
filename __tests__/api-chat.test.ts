/**
 * Integration-ish tests for POST /api/chat.
 * We mock the LLM, Tavily, and traces modules so we can drive the
 * router/search/answer pipeline end-to-end without network calls.
 */

jest.mock('@/lib/gemini', () => ({
  checkSufficiencyWithDebug: jest.fn(),
  generateChatResponseWithDebug: jest.fn(),
}));

jest.mock('@/lib/search', () => ({
  searchTavily: jest.fn(),
  isSearchAvailable: jest.fn(),
  formatSearchResultsForLLM: jest.fn(
    (results: { title: string; url: string }[]) =>
      results.map((r, i) => `[${i + 1}] "${r.title}" — example.com\nURL: ${r.url}`).join('\n\n')
  ),
}));

jest.mock('@/lib/traces', () => ({
  insertChatTrace: jest.fn().mockResolvedValue(undefined),
  resetTraceWarning: jest.fn(),
}));

import { POST } from '@/app/api/chat/route';
import {
  checkSufficiencyWithDebug,
  generateChatResponseWithDebug,
} from '@/lib/gemini';
import {
  searchTavily,
  isSearchAvailable,
} from '@/lib/search';
import { insertChatTrace } from '@/lib/traces';
import { DECLINE_META, DECLINE_OFF_TOPIC } from '@/lib/canned-responses';

const mockedRouter = checkSufficiencyWithDebug as jest.MockedFunction<
  typeof checkSufficiencyWithDebug
>;
const mockedTutor = generateChatResponseWithDebug as jest.MockedFunction<
  typeof generateChatResponseWithDebug
>;
const mockedSearch = searchTavily as jest.MockedFunction<typeof searchTavily>;
const mockedIsSearchAvailable = isSearchAvailable as jest.MockedFunction<
  typeof isSearchAvailable
>;
const mockedInsertTrace = insertChatTrace as jest.MockedFunction<typeof insertChatTrace>;

function makeRequest(body: Record<string, unknown>) {
  return { json: async () => body } as unknown as Parameters<typeof POST>[0];
}

function routerResult(overrides: Partial<{
  intent: 'answer' | 'decline_meta' | 'decline_off_topic';
  need_web: boolean;
  suggested_queries: string[];
  reason: string;
  must_cite: boolean;
}> = {}) {
  const result = {
    intent: 'answer' as const,
    need_web: false,
    reason: 'ok',
    suggested_queries: [] as string[],
    must_cite: false,
    ...overrides,
  };
  return {
    result,
    debug: {
      article_excerpt_used: '',
      recent_history_used: '',
      user_prompt: '',
      model: 'test-model',
      max_tokens: 200,
      raw_output: JSON.stringify(result),
      parse_ok: true,
      parse_error: '',
      used_default: false,
    },
  };
}

function tutorResult(answer: string) {
  return {
    answer,
    debug: {
      model: 'test-model',
      max_output_tokens: 900,
      article_was_truncated: false,
      article_chars_in: 100,
      article_chars_used: 100,
      strict_sources_instruction_added: false,
      system_prompt_sent: '',
      history_sent: [],
      user_message_sent: '',
      raw_model_output: answer,
      postprocess: {
        used_search_context: false,
        stripped_numeric_markers: false,
        sources_near_end_before: false,
        parsed_sources_from_context: [],
        appended_deterministic_sources: false,
        returned_incomplete_fallback: false,
      },
    },
  };
}

const baseBody = {
  articleText: 'Some article body about a recent event.',
  userMessage: 'placeholder',
  chatHistory: [],
  session_id: 's1',
  article_id: 'a1',
  thread_id: 't1',
  article_title: 'Test',
};

beforeEach(() => {
  mockedRouter.mockReset();
  mockedTutor.mockReset();
  mockedSearch.mockReset();
  mockedIsSearchAvailable.mockReset();
  mockedInsertTrace.mockClear();
});

describe('POST /api/chat — short-circuit on decline intents', () => {
  it('returns the off-topic canned response and skips search + tutor', async () => {
    mockedRouter.mockResolvedValueOnce(routerResult({ intent: 'decline_off_topic' }));
    mockedIsSearchAvailable.mockReturnValue(true);

    const res = await POST(
      makeRequest({ ...baseBody, userMessage: "what's the weather in Paris?" })
    );
    const body = await res.json();

    expect(body.assistantMessage).toBe(DECLINE_OFF_TOPIC);
    expect(mockedSearch).not.toHaveBeenCalled();
    expect(mockedTutor).not.toHaveBeenCalled();
    expect(mockedInsertTrace).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(200);
  });

  it('returns the meta canned response and skips search + tutor', async () => {
    mockedRouter.mockResolvedValueOnce(routerResult({ intent: 'decline_meta' }));
    mockedIsSearchAvailable.mockReturnValue(true);

    const res = await POST(
      makeRequest({ ...baseBody, userMessage: 'what LLM are you?' })
    );
    const body = await res.json();

    expect(body.assistantMessage).toBe(DECLINE_META);
    expect(mockedSearch).not.toHaveBeenCalled();
    expect(mockedTutor).not.toHaveBeenCalled();
  });
});

describe('POST /api/chat — answer path', () => {
  it('calls tutor without search context when router says need_web=false', async () => {
    mockedRouter.mockResolvedValueOnce(routerResult({ need_web: false }));
    mockedIsSearchAvailable.mockReturnValue(true);
    mockedTutor.mockResolvedValueOnce(tutorResult('article-only answer'));

    const res = await POST(
      makeRequest({ ...baseBody, userMessage: 'what does this mean?' })
    );
    const body = await res.json();

    expect(body.assistantMessage).toBe('article-only answer');
    expect(mockedSearch).not.toHaveBeenCalled();
    expect(mockedTutor).toHaveBeenCalledTimes(1);
    expect(mockedTutor.mock.calls[0][3]).toBe('');
    expect(mockedInsertTrace).toHaveBeenCalledTimes(1);
  });

  it('runs Tavily then tutor with search context when need_web=true', async () => {
    mockedRouter.mockResolvedValueOnce(
      routerResult({ need_web: true, suggested_queries: ['fed rate cut'] })
    );
    mockedIsSearchAvailable.mockReturnValue(true);
    mockedSearch.mockResolvedValueOnce({
      results: [{ title: 'Fed cuts rates', url: 'https://reuters.com/x', source: 'reuters.com', content: 'snippet' }],
      timedOut: false,
    } as unknown as Awaited<ReturnType<typeof searchTavily>>);
    mockedTutor.mockResolvedValueOnce(tutorResult('grounded answer'));

    const res = await POST(
      makeRequest({ ...baseBody, userMessage: 'how does this compare to past cuts?' })
    );
    const body = await res.json();

    expect(mockedSearch).toHaveBeenCalledTimes(1);
    expect(mockedSearch.mock.calls[0][0]).toEqual(['fed rate cut']);
    expect(mockedTutor).toHaveBeenCalledTimes(1);

    const searchCtxArg = mockedTutor.mock.calls[0][3];
    expect(searchCtxArg).toContain('Fed cuts rates');
    expect(searchCtxArg).toContain('https://reuters.com/x');

    // Sources are now returned structured — not embedded in the prose
    expect(body.sources).toEqual(
      expect.arrayContaining([expect.objectContaining({ url: 'https://reuters.com/x' })])
    );
    expect(body.fromWebSearch).toBe(true);
    expect(body.assistantMessage).not.toContain('Sources:');
  });

  it('skips Tavily when search is unavailable, even if router says need_web=true', async () => {
    mockedRouter.mockResolvedValueOnce(
      routerResult({ need_web: true, suggested_queries: ['fed rate cut'] })
    );
    mockedIsSearchAvailable.mockReturnValue(false);
    mockedTutor.mockResolvedValueOnce(tutorResult('article-only fallback'));

    const res = await POST(makeRequest({ ...baseBody, userMessage: 'q' }));
    const body = await res.json();

    expect(mockedSearch).not.toHaveBeenCalled();
    expect(mockedTutor).toHaveBeenCalledTimes(1);
    expect(mockedTutor.mock.calls[0][3]).toBe('');
    expect(body.assistantMessage).toBe('article-only fallback');
    expect(body.fromWebSearch).toBe(false);
    expect(body.sources).toEqual([]);
  });
});

describe('POST /api/chat — input validation', () => {
  it('rejects missing articleText with 400', async () => {
    const res = await POST(
      makeRequest({ userMessage: 'q', chatHistory: [], session_id: 's', article_id: 'a', thread_id: 't' })
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('articleText');
    expect(mockedRouter).not.toHaveBeenCalled();
  });

  it('rejects missing userMessage with 400', async () => {
    const res = await POST(
      makeRequest({ articleText: 'a', chatHistory: [], session_id: 's', article_id: 'a', thread_id: 't' })
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('userMessage');
  });

  it('rejects non-array chatHistory with 400', async () => {
    const res = await POST(
      makeRequest({ articleText: 'a', userMessage: 'q', chatHistory: 'not-array', session_id: 's', article_id: 'a', thread_id: 't' })
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('chatHistory');
  });
});
