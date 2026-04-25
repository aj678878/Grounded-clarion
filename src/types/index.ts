/* ------------------------------------------------------------------ */
/*  Grounded — shared TypeScript types                                */
/* ------------------------------------------------------------------ */

// Guardian feed article (summary)
export interface GuardianArticle {
  id: string;
  webTitle: string;
  webPublicationDate: string;
  sectionName: string;
  sectionId: string;
  webUrl: string;
  trailText?: string;
  thumbnail?: string;
  category: string; // feed category this article was fetched under
}

// Full article with body HTML
export interface ArticleDetail extends GuardianArticle {
  bodyHtml: string;
  wordcount?: number;
  byline?: string;
}

// Feed API response
export interface FeedResponse {
  articles: GuardianArticle[];
  page: number;
  hasMore: boolean;
}

// Article API response
export interface ArticleResponse {
  article: ArticleDetail;
}

// Chat message (user ↔ assistant)
export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  threadId?: string;
}

// POST /api/chat request body
export interface ChatRequest {
  session_id: string;
  article_id: string;
  article_title?: string;
  articleText: string;
  chatHistory: ChatMessage[];
  userMessage: string;
  thread_id: string;
}

// POST /api/chat response body
export interface ChatResponse {
  assistantMessage: string;
}

// POST /api/metric request body
export interface MetricEvent {
  session_id: string;
  article_id: string;
  thread_id: string;
  event_type: 'thread_started' | 'turn_added' | 'clear_clicked';
  payload?: Record<string, unknown>;
}

// Metric API response
export interface MetricResponse {
  id: string | null;
}

// Section colour mapping
export const SECTION_COLORS: Record<string, string> = {
  business: 'bg-rose-800/10 text-rose-800 border-rose-800/20',
  world: 'bg-sky-700/10 text-sky-700 border-sky-700/20',
  technology: 'bg-emerald-700/10 text-emerald-700 border-emerald-700/20',
  india: 'bg-orange-600/10 text-orange-600 border-orange-600/20',
};

export const CATEGORIES = ['All', 'Business', 'World', 'Technology', 'India'] as const;
export type Category = (typeof CATEGORIES)[number];
