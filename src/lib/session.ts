/* ------------------------------------------------------------------ */
/*  Client-side session & thread ID helpers                           */
/*  Must only be called from client components / browser context.     */
/* ------------------------------------------------------------------ */

const SESSION_KEY = 'grounded_session_id';

/** Get or create a session ID (persists in sessionStorage). */
export function getSessionId(): string {
  if (typeof window === 'undefined') return '';
  let sid = sessionStorage.getItem(SESSION_KEY);
  if (!sid) {
    sid = crypto.randomUUID();
    sessionStorage.setItem(SESSION_KEY, sid);
  }
  return sid;
}

/** Generate a new thread ID. */
export function generateThreadId(): string {
  return crypto.randomUUID();
}

/* ------------------------------------------------------------------ */
/*  Client-side article cache (sessionStorage)                        */
/* ------------------------------------------------------------------ */

const ARTICLE_CACHE_PREFIX = 'grounded_article_';

export function getCachedArticle(id: string): string | null {
  if (typeof window === 'undefined') return null;
  return sessionStorage.getItem(ARTICLE_CACHE_PREFIX + id);
}

export function setCachedArticle(id: string, data: string): void {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.setItem(ARTICLE_CACHE_PREFIX + id, data);
  } catch {
    // sessionStorage quota exceeded — ignore
  }
}
