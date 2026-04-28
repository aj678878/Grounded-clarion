import { createPool, type VercelPool } from '@vercel/postgres';
import {
  formatPostgresTargetLabel,
  getPostgresConnectionString,
} from '@/lib/postgres-connection';
import {
  synthesisTraceSchema,
  type SynthesisTraceInput,
  type SynthesisPhaseRecord,
} from './schema';

let pool: VercelPool | null = null;
const TRACE_INSERT_TIMEOUT_MS = 2_500;

function getPool(): VercelPool | null {
  if (pool) return pool;
  const connectionString = getPostgresConnectionString();
  if (!connectionString) return null;
  pool = createPool({ connectionString });
  return pool;
}

export interface SynthesisTraceRow extends SynthesisTraceInput {
  id?: number;
  created_at?: string;
}

function normalizeTraceInput(trace: SynthesisTraceInput): SynthesisTraceInput {
  const tid = trace.thread_id;
  const trimmed =
    typeof tid === 'string' ? tid.trim() : '';
  return {
    ...trace,
    thread_id: trimmed.length > 0 ? tid as string : null,
  };
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    promise.then(
      (value) => {
        clearTimeout(timeoutId);
        resolve(value);
      },
      (err) => {
        clearTimeout(timeoutId);
        reject(err);
      }
    );
  });
}

export async function insertSynthesisTrace(trace: SynthesisTraceInput): Promise<number | null> {
  const db = getPool();
  if (!db) return null;

  const parsed = synthesisTraceSchema.safeParse(normalizeTraceInput(trace));
  if (!parsed.success) {
    console.error('[synthesis-traces] Invalid trace payload:', parsed.error.flatten());
    return null;
  }

  try {
    const { rows } = await withTimeout(
      db.query(
        `INSERT INTO synthesis_traces (
          article_id, thread_id, status, phases, cost_usd_estimate, total_duration_ms,
          bias_diversity_warning, apify_invocations, paywall_count,
          sources_attempted, sources_used, synthesis_payload
        ) VALUES (
          $1, $2, $3, $4::jsonb, $5, $6,
          $7, $8, $9,
          $10, $11, $12::jsonb
        ) RETURNING id`,
        [
          parsed.data.article_id,
          parsed.data.thread_id ?? null,
          parsed.data.status,
          JSON.stringify(parsed.data.phases),
          parsed.data.cost_usd_estimate ?? null,
          parsed.data.total_duration_ms,
          parsed.data.bias_diversity_warning ?? false,
          parsed.data.apify_invocations ?? 0,
          parsed.data.paywall_count ?? 0,
          parsed.data.sources_attempted ?? null,
          parsed.data.sources_used ?? null,
          JSON.stringify(parsed.data.synthesis_payload ?? null),
        ]
      ),
      TRACE_INSERT_TIMEOUT_MS,
      'synthesis trace insert'
    );

    return rows[0]?.id ?? null;
  } catch (err) {
    const cs = getPostgresConnectionString();
    console.error('[synthesis-traces] Failed to insert trace:', err);
    if (cs) {
      console.error(
        `[synthesis-traces] Run migration db/migrations/20260428_add_synthesis_traces.sql on THIS database: ${formatPostgresTargetLabel(cs)}`
      );
    }
    return null;
  }
}

export async function getRecentSynthesisTraces(limit = 20): Promise<{
  traces: SynthesisTraceRow[];
  /** Postgres / pool issue — same DB can have chat_traces without synthesis_traces if migration missing */
  fetchError: string | null;
  databaseConfigured: boolean;
}> {
  if (!getPostgresConnectionString()) {
    return { traces: [], fetchError: null, databaseConfigured: false };
  }
  const db = getPool();
  if (!db) {
    return { traces: [], fetchError: null, databaseConfigured: false };
  }

  try {
    const { rows } = await db.query(
      `SELECT * FROM synthesis_traces ORDER BY created_at DESC LIMIT $1`,
      [limit]
    );
    return {
      traces: rows as SynthesisTraceRow[],
      fetchError: null,
      databaseConfigured: true,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[synthesis-traces] Failed to fetch traces:', err);
    return { traces: [], fetchError: msg, databaseConfigured: true };
  }
}

export function buildPhaseRecord(
  phase: SynthesisPhaseRecord['phase'],
  status: SynthesisPhaseRecord['status'],
  duration_ms: number,
  metadata?: Record<string, unknown>
): SynthesisPhaseRecord {
  return {
    phase,
    status,
    duration_ms,
    metadata,
  };
}
