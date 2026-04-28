/**
 * Single place to resolve Postgres URL. Vercel’s Postgres integration may set
 * POSTGRES_* while the app historically used DATABASE_URL — prefer one explicit
 * chain so migrations and runtime always match.
 */
export function getPostgresConnectionString(): string | undefined {
  const candidates = [
    process.env.DATABASE_URL,
    process.env.POSTGRES_URL,
    process.env.POSTGRES_PRISMA_URL,
  ];
  for (const c of candidates) {
    const t = typeof c === 'string' ? c.trim() : '';
    if (t.length > 0) return t;
  }
  return undefined;
}

/** Host + DB name only (helps verify migration ran on the same DB as the deployment). */
export function formatPostgresTargetLabel(connectionString: string): string {
  try {
    const normalized = connectionString.startsWith('postgres://')
      ? connectionString.replace(/^postgres:\/\//, 'postgresql://')
      : connectionString;
    const u = new URL(normalized.replace(/^postgresql\+\w+:\/\//, 'postgresql://'));
    const db = (u.pathname || '').replace(/^\/+|\/+$/g, '') || '(dbname?)';
    return `${u.hostname} • database "${db}"`;
  } catch {
    return '(unable to parse DATABASE_URL / POSTGRES_*)';
  }
}
