/**
 * Minimal validation tests for API route input parsing.
 * We test the validation logic inline rather than importing route handlers
 * (Next.js route handlers are tightly coupled to NextRequest/NextResponse).
 */

const VALID_EVENT_TYPES = new Set(['thread_started', 'turn_added', 'clear_clicked']);

function validateMetricEvent(body: Record<string, unknown>): string | null {
  if (!body.session_id || typeof body.session_id !== 'string') return 'Missing or invalid: session_id';
  if (!body.article_id || typeof body.article_id !== 'string') return 'Missing or invalid: article_id';
  if (!body.thread_id || typeof body.thread_id !== 'string') return 'Missing or invalid: thread_id';
  if (!body.event_type || !VALID_EVENT_TYPES.has(body.event_type as string))
    return 'Invalid event_type';
  return null;
}

function validateChatRequest(body: Record<string, unknown>): string | null {
  if (!body.articleText || typeof body.articleText !== 'string') return 'Missing or invalid: articleText';
  if (!body.userMessage || typeof body.userMessage !== 'string') return 'Missing or invalid: userMessage';
  if (!Array.isArray(body.chatHistory)) return 'Missing or invalid: chatHistory';
  return null;
}

describe('metric event validation', () => {
  it('passes with valid input', () => {
    expect(
      validateMetricEvent({
        session_id: 'abc',
        article_id: 'world/2024/test',
        thread_id: 'uuid-1',
        event_type: 'thread_started',
      })
    ).toBeNull();
  });

  it('rejects missing session_id', () => {
    expect(
      validateMetricEvent({
        article_id: 'world/2024/test',
        thread_id: 'uuid-1',
        event_type: 'thread_started',
      })
    ).toContain('session_id');
  });

  it('rejects invalid event_type', () => {
    expect(
      validateMetricEvent({
        session_id: 'abc',
        article_id: 'world/2024/test',
        thread_id: 'uuid-1',
        event_type: 'invalid_type',
      })
    ).toContain('event_type');
  });

  it('rejects non-string article_id', () => {
    expect(
      validateMetricEvent({
        session_id: 'abc',
        article_id: 123,
        thread_id: 'uuid-1',
        event_type: 'turn_added',
      })
    ).toContain('article_id');
  });
});

describe('chat request validation', () => {
  it('passes with valid input', () => {
    expect(
      validateChatRequest({
        articleText: 'Some article body…',
        userMessage: 'What does it mean?',
        chatHistory: [],
      })
    ).toBeNull();
  });

  it('rejects missing articleText', () => {
    expect(
      validateChatRequest({
        userMessage: 'Hello',
        chatHistory: [],
      })
    ).toContain('articleText');
  });

  it('rejects non-array chatHistory', () => {
    expect(
      validateChatRequest({
        articleText: 'text',
        userMessage: 'Hello',
        chatHistory: 'not-an-array',
      })
    ).toContain('chatHistory');
  });

  it('rejects empty userMessage', () => {
    expect(
      validateChatRequest({
        articleText: 'text',
        userMessage: '',
        chatHistory: [],
      })
    ).toContain('userMessage');
  });
});
