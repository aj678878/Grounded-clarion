/* ------------------------------------------------------------------ */
/*  Vercel Postgres — metrics event persistence                       */
/*  Gracefully no-ops when DATABASE_URL is not configured.            */
/* ------------------------------------------------------------------ */

import { createPool, type VercelPool } from '@vercel/postgres';
import { MetricEvent } from '@/types';

let pool: VercelPool | null = null;

function getPool(): VercelPool | null {
  if (pool) return pool;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) return null;
  pool = createPool({ connectionString });
  return pool;
}

/** Insert a metric event. Returns the UUID or null if DB is not configured. */
export async function insertMetricEvent(event: MetricEvent): Promise<string | null> {
  const db = getPool();
  if (!db) {
    console.warn('[metrics] DATABASE_URL not configured — event skipped:', event.event_type);
    return null;
  }

  const id = crypto.randomUUID();
  const payloadJson = JSON.stringify(event.payload ?? {});

  await db.query(
    `INSERT INTO metric_events (id, created_at, session_id, article_id, thread_id, event_type, payload)
     VALUES ($1, NOW(), $2, $3, $4, $5, $6::jsonb)`,
    [id, event.session_id, event.article_id, event.thread_id, event.event_type, payloadJson]
  );

  return id;
}
