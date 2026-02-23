/* ------------------------------------------------------------------ */
/*  Chat trace persistence + retrieval                                */
/*  Gracefully no-ops when DATABASE_URL is not configured.            */
/* ------------------------------------------------------------------ */

import { createPool, type VercelPool } from '@vercel/postgres';

let pool: VercelPool | null = null;

function getPool(): VercelPool | null {
  if (pool) return pool;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) return null;
  pool = createPool({ connectionString });
  return pool;
}

/* ---------- Trace type ---------- */

export interface ChatTrace {
  id?: string;
  created_at?: string;
  session_id: string;
  article_id: string;
  thread_id: string;
  user_message: string;

  router_need_web: boolean | null;
  router_reason: string | null;
  router_suggested_queries: string[] | null;

  search_called: boolean;
  search_queries: string[] | null;
  search_sources: { title: string; url: string; domain: string }[] | null;
  search_error: string | null;

  answer_text: string;
  citations_present: boolean;
  answer_char_count: number;

  latency_router_ms: number | null;
  latency_search_ms: number | null;
  latency_answer_ms: number | null;
  latency_total_ms: number;
  debug_flow?: Record<string, unknown> | null;
}

/* ---------- Insert ---------- */

export async function insertChatTrace(trace: ChatTrace): Promise<string | null> {
  const db = getPool();
  if (!db) {
    console.warn('[traces] DATABASE_URL not configured — trace skipped');
    return null;
  }

  try {
    const { rows } = await db.query(
      `INSERT INTO chat_traces (
        session_id, article_id, thread_id, user_message,
        router_need_web, router_reason, router_suggested_queries,
        search_called, search_queries, search_sources, search_error,
        answer_text, citations_present, answer_char_count,
        latency_router_ms, latency_search_ms, latency_answer_ms, latency_total_ms,
        debug_flow
      ) VALUES (
        $1, $2, $3, $4,
        $5, $6, $7::jsonb,
        $8, $9::jsonb, $10::jsonb, $11,
        $12, $13, $14,
        $15, $16, $17, $18,
        $19::jsonb
      ) RETURNING id`,
      [
        trace.session_id,
        trace.article_id,
        trace.thread_id,
        trace.user_message,
        trace.router_need_web,
        trace.router_reason,
        JSON.stringify(trace.router_suggested_queries),
        trace.search_called,
        JSON.stringify(trace.search_queries),
        JSON.stringify(trace.search_sources),
        trace.search_error,
        trace.answer_text,
        trace.citations_present,
        trace.answer_char_count,
        trace.latency_router_ms,
        trace.latency_search_ms,
        trace.latency_answer_ms,
        trace.latency_total_ms,
        JSON.stringify(trace.debug_flow ?? null),
      ]
    );
    return rows[0]?.id ?? null;
  } catch (err) {
    console.error('[traces] Failed to insert trace:', err);
    return null;
  }
}

/* ---------- Fetch recent ---------- */

export async function getRecentTraces(limit = 50): Promise<ChatTrace[]> {
  const db = getPool();
  if (!db) return [];

  try {
    const { rows } = await db.query(
      `SELECT * FROM chat_traces ORDER BY created_at DESC LIMIT $1`,
      [limit]
    );
    return rows as ChatTrace[];
  } catch (err) {
    console.error('[traces] Failed to fetch traces:', err);
    return [];
  }
}
