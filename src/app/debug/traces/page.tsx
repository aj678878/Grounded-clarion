/* ------------------------------------------------------------------ */
/*  /debug/traces — Chat trace viewer (observability)                 */
/*  Gated in production via query key: ?key=<DEBUG_TRACES_KEY|debug>. */
/* ------------------------------------------------------------------ */

import { getRecentTraces, type ChatTrace } from '@/lib/traces';
import { getRecentSynthesisTraces, type SynthesisTraceRow } from '@/lib/synthesis/traces';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface PageProps {
  searchParams: { key?: string | string[]; full?: string | string[]; limit?: string | string[] };
}

export default async function TracesPage({ searchParams }: PageProps) {
  // Access gate:
  // - dev: always allow
  // - prod: require ?key=<DEBUG_TRACES_KEY> if set, else ?key=debug
  const isProd = process.env.NODE_ENV === 'production';
  const providedKey = Array.isArray(searchParams.key)
    ? searchParams.key[0] ?? ''
    : searchParams.key ?? '';
  const configuredKey = (process.env.DEBUG_TRACES_KEY ?? '').trim();
  const requiredKey = configuredKey || 'debug';
  const isAuthorized = !isProd || providedKey === requiredKey;
  const fullParam = Array.isArray(searchParams.full)
    ? searchParams.full[0] ?? ''
    : searchParams.full ?? '';
  const limitParam = Array.isArray(searchParams.limit)
    ? searchParams.limit[0] ?? ''
    : searchParams.limit ?? '';
  const includeDebugFlow = fullParam === '1';
  const parsedLimit = Number.parseInt(limitParam, 10);
  const limit = Number.isFinite(parsedLimit)
    ? Math.max(1, Math.min(parsedLimit, includeDebugFlow ? 20 : 100))
    : includeDebugFlow
    ? 10
    : 25;

  if (!isAuthorized) {
    return (
      <div className="min-h-screen bg-gray-50 font-body">
        <main className="mx-auto max-w-2xl px-6 py-12">
          <div className="rounded-lg border border-amber-200 bg-white p-6">
            <h1 className="font-headline text-lg font-semibold text-gray-900">
              Debug Access Required
            </h1>
            <p className="mt-2 text-sm text-gray-600">
              This page is protected in production.
            </p>
            <p className="mt-2 text-sm text-gray-600">
              Open with <code>?key=...</code> using the configured debug key.
            </p>
          </div>
        </main>
      </div>
    );
  }

  const traces = await getRecentTraces(limit, includeDebugFlow, 4000);
  const synthesis = await getRecentSynthesisTraces(limit);

  const synthHint = (() => {
    if (!synthesis.databaseConfigured) {
      return {
        variant: 'amber' as const,
        title: 'Trace database not configured',
        body:
          'DATABASE_URL / POSTGRES_URL is not available to this handler, so Postgres-backed traces cannot be loaded. Configure it locally (`.env.local`) or in Vercel project settings for preview/production.',
      };
    }
    if (synthesis.fetchError) {
      const missingTable =
        /relation ["']synthesis_traces["'] does not exist/i.test(synthesis.fetchError);
      return {
        variant: missingTable ? ('amber' as const) : ('red' as const),
        title: missingTable ? 'Synthesis traces table missing' : 'Could not load synthesis traces',
        body: missingTable
          ? 'Run migration db/migrations/20260428_add_synthesis_traces.sql on the DATABASE_URL database (e.g. Vercel Storage → Postgres → query, or psql). chat_traces can exist without synthesis_traces if this migration was skipped.'
          : synthesis.fetchError,
      };
    }
    return null;
  })();

  return (
    <div className="min-h-screen bg-gray-50 font-body">
      {/* Header */}
      <header className="sticky top-0 z-10 border-b border-gray-200 bg-white px-6 py-3">
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <div>
            <h1 className="font-headline text-lg font-bold text-gray-900">
              Trace Viewer
            </h1>
              <p className="text-xs text-gray-400">
              Last {traces.length} chat interactions
              {includeDebugFlow ? ' (full debug payloads loaded)' : ' (summary mode)'}
            </p>
          </div>
          <a
            href="/"
            className="text-sm text-primary hover:underline"
          >
            ← Back to app
          </a>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
        {traces.length === 0 ? (
          <div className="rounded-lg border border-gray-200 bg-white px-6 py-16 text-center">
            <p className="text-sm text-gray-400">
              No traces yet. Send a chat message to generate one.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {traces.map((trace) => (
              <TraceCard key={trace.id} trace={trace} />
            ))}
          </div>
        )}

        <section className="mt-10">
          <div className="mb-3">
            <h2 className="font-headline text-xl font-bold text-gray-900">Synthesis traces</h2>
            <p className="text-xs text-gray-400">Compare Sources runs (Postgres table synthesis_traces)</p>
          </div>
          {synthHint && (
            <div
              role="alert"
              className={`mb-4 rounded-lg border px-4 py-3 text-sm ${
                synthHint.variant === 'amber'
                  ? 'border-amber-200 bg-amber-50 text-amber-950'
                  : 'border-red-200 bg-red-50 text-red-900'
              }`}
            >
              <p className="font-semibold">{synthHint.title}</p>
              <p className="mt-1 text-[13px] leading-relaxed">{synthHint.body}</p>
            </div>
          )}
          {synthesis.traces.length === 0 ? (
            <div className="rounded-lg border border-gray-200 bg-white px-6 py-10 text-center text-sm text-gray-400">
              {synthHint
                ? 'No rows displayed because of the issue above.'
                : 'No synthesis traces yet — run Compare Sources on this deployment after the table exists.'}
            </div>
          ) : (
            <div className="space-y-4">
              {synthesis.traces.map((trace) => (
                <SynthesisTraceCard key={trace.id ?? `${trace.article_id}-${trace.created_at}`} trace={trace} />
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Trace Card                                                        */
/* ------------------------------------------------------------------ */

function TraceCard({ trace }: { trace: ChatTrace }) {
  const isError = trace.answer_text.startsWith('ERROR:');

  return (
    <div
      className={`rounded-lg border bg-white shadow-sm overflow-hidden ${
        isError ? 'border-red-200' : 'border-gray-200'
      }`}
    >
      {/* Top bar: timestamp + IDs + total latency */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-gray-100 bg-gray-50/50 px-4 py-2 text-xs">
        <span className="font-medium text-gray-600">
          {formatTimestamp(trace.created_at)}
        </span>
        <span className="text-gray-400">
          article: <code className="text-gray-600">{truncate(trace.article_id, 40)}</code>
        </span>
        <span className="text-gray-400">
          thread: <code className="text-gray-600">{truncate(trace.thread_id, 12)}</code>
        </span>
        <span className="ml-auto font-mono font-medium text-gray-700">
          {trace.latency_total_ms}ms total
        </span>
      </div>

      <div className="px-4 py-3 space-y-3">
        {/* User message */}
        <div>
          <Label>User Message</Label>
          <p className="text-sm text-gray-800 bg-blue-50 rounded px-3 py-2 mt-1">
            {trace.user_message}
          </p>
        </div>

        {/* Router */}
        <div className="flex flex-wrap gap-4">
          <div className="flex-1 min-w-[200px]">
            <Label>Router Decision</Label>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <Badge
                color={
                  trace.router_need_web === true
                    ? 'blue'
                    : trace.router_need_web === false
                    ? 'gray'
                    : 'yellow'
                }
              >
                {trace.router_need_web === true
                  ? 'need_web = true'
                  : trace.router_need_web === false
                  ? 'need_web = false'
                  : 'no router'}
              </Badge>
              {trace.latency_router_ms != null && (
                <span className="text-xs text-gray-400 font-mono">
                  {trace.latency_router_ms}ms
                </span>
              )}
            </div>
            {trace.router_reason && (
              <p className="mt-1 text-xs text-gray-500 italic">
                {trace.router_reason}
              </p>
            )}
            {trace.router_suggested_queries && (trace.router_suggested_queries as string[]).length > 0 && (
              <div className="mt-1 flex flex-wrap gap-1">
                {(trace.router_suggested_queries as string[]).map((q, i) => (
                  <code key={i} className="text-xs bg-gray-100 px-1.5 py-0.5 rounded text-gray-600">
                    {q}
                  </code>
                ))}
              </div>
            )}
          </div>

          {/* Search */}
          <div className="flex-1 min-w-[200px]">
            <Label>Search</Label>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <Badge color={trace.search_called ? 'green' : 'gray'}>
                {trace.search_called ? 'called' : 'skipped'}
              </Badge>
              {trace.search_called && trace.latency_search_ms != null && (
                <span className="text-xs text-gray-400 font-mono">
                  {trace.latency_search_ms}ms
                </span>
              )}
              {trace.search_sources && (
                <span className="text-xs text-gray-500">
                  {(trace.search_sources as { title: string; url: string; domain: string }[]).length} sources
                </span>
              )}
            </div>
            {trace.search_error && (
              <p className="mt-1 text-xs text-red-500">
                Error: {trace.search_error}
              </p>
            )}
            {trace.search_sources && (trace.search_sources as { title: string; url: string; domain: string }[]).length > 0 && (
              <ul className="mt-1 space-y-0.5">
                {(trace.search_sources as { title: string; url: string; domain: string }[]).map((src, i) => (
                  <li key={i} className="text-xs text-gray-500">
                    <span className="font-medium text-gray-600">{src.domain}</span>
                    {' — '}
                    <a
                      href={src.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary hover:underline"
                    >
                      {truncate(src.title, 50)}
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* Answer stats */}
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <Badge color={trace.citations_present ? 'green' : 'gray'}>
            {trace.citations_present ? 'citations ✓' : 'no citations'}
          </Badge>
          <span className="text-gray-400">
            {trace.answer_char_count} chars
          </span>
          {trace.latency_answer_ms != null && (
            <span className="text-gray-400 font-mono">
              answer: {trace.latency_answer_ms}ms
            </span>
          )}

          {/* Latency breakdown */}
          <span className="ml-auto text-gray-400">
            {[
              trace.latency_router_ms != null ? `router ${trace.latency_router_ms}ms` : null,
              trace.latency_search_ms != null ? `search ${trace.latency_search_ms}ms` : null,
              trace.latency_answer_ms != null ? `answer ${trace.latency_answer_ms}ms` : null,
            ]
              .filter(Boolean)
              .join(' → ')}
          </span>
        </div>

        {/* Collapsible answer */}
        <details className="group">
          <summary className="cursor-pointer text-xs font-medium text-gray-500 hover:text-gray-700">
            {isError ? '⚠️ Show error' : 'Show answer text'}
          </summary>
          <pre
            className={`mt-2 max-h-64 overflow-auto rounded p-3 text-xs whitespace-pre-wrap ${
              isError ? 'bg-red-50 text-red-700' : 'bg-gray-50 text-gray-700'
            }`}
          >
            {trace.answer_text}
          </pre>
        </details>

        {trace.debug_flow && (
          <details className="group">
            <summary className="cursor-pointer text-xs font-medium text-gray-500 hover:text-gray-700">
              Show deep debug flow ({formatBytes(jsonSize(trace.debug_flow))})
            </summary>
            <div className="mt-2 space-y-2">
              {renderDebugStage('request_meta', (trace.debug_flow as Record<string, unknown>).request_meta)}
              {renderDebugStage('incoming_payload', (trace.debug_flow as Record<string, unknown>).incoming_payload)}
              {renderDebugStage('sanitized', (trace.debug_flow as Record<string, unknown>).sanitized)}
              {renderDebugStage('router_input', (trace.debug_flow as Record<string, unknown>).router_input)}
              {renderDebugStage('router_output', (trace.debug_flow as Record<string, unknown>).router_output)}
              {renderDebugStage('search_plan', (trace.debug_flow as Record<string, unknown>).search_plan)}
              {renderDebugStage('tavily_request', (trace.debug_flow as Record<string, unknown>).tavily_request)}
              {renderDebugStage('tavily_raw_response', (trace.debug_flow as Record<string, unknown>).tavily_raw_response)}
              {renderDebugStage('search_transform', (trace.debug_flow as Record<string, unknown>).search_transform)}
              {renderDebugStage('search_context_output', (trace.debug_flow as Record<string, unknown>).search_context_output)}
              {renderDebugStage('answer_input', (trace.debug_flow as Record<string, unknown>).answer_input)}
              {renderDebugStage('answer_output', (trace.debug_flow as Record<string, unknown>).answer_output)}
              {renderDebugStage('timing', (trace.debug_flow as Record<string, unknown>).timing)}
              {renderDebugStage('final', (trace.debug_flow as Record<string, unknown>).final)}
            </div>
          </details>
        )}
      </div>
    </div>
  );
}

function SynthesisTraceCard({ trace }: { trace: SynthesisTraceRow }) {
  const payload = trace.synthesis_payload as Record<string, unknown> | null | undefined;
  return (
    <div className="rounded-lg border border-gray-200 bg-white shadow-sm overflow-hidden">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-gray-100 bg-gray-50/50 px-4 py-2 text-xs">
        <span className="font-medium text-gray-600">{formatTimestamp(trace.created_at)}</span>
        <span className="text-gray-400">article: <code className="text-gray-600">{truncate(trace.article_id, 40)}</code></span>
        <span className="text-gray-400">thread: <code className="text-gray-600">{truncate(trace.thread_id ?? '—', 12)}</code></span>
        <span className="ml-auto font-mono font-medium text-gray-700">{trace.total_duration_ms}ms total</span>
      </div>
      <div className="px-4 py-3 space-y-2 text-xs">
        <div className="flex flex-wrap gap-2">
          <Badge color={trace.status === 'success' ? 'green' : 'yellow'}>{trace.status}</Badge>
          <Badge color={trace.bias_diversity_warning ? 'yellow' : 'gray'}>
            {trace.bias_diversity_warning ? 'bias warning' : 'bias ok'}
          </Badge>
          <span className="text-gray-400">sources: {trace.sources_used ?? 0}/{trace.sources_attempted ?? 0}</span>
          <span className="text-gray-400">cost: ${Number(trace.cost_usd_estimate ?? 0).toFixed(4)}</span>
        </div>
        <details>
          <summary className="cursor-pointer text-xs font-medium text-gray-500">Show synthesis payload</summary>
          <pre className="mt-2 max-h-72 overflow-auto rounded bg-gray-50 p-3 text-xs whitespace-pre-wrap text-gray-700">
            {safeStringify(payload ?? trace.synthesis_payload)}
          </pre>
        </details>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Tiny helper components                                            */
/* ------------------------------------------------------------------ */

function Label({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs font-medium uppercase tracking-wider text-gray-400">
      {children}
    </p>
  );
}

function Badge({
  children,
  color,
}: {
  children: React.ReactNode;
  color: 'blue' | 'green' | 'gray' | 'yellow' | 'red';
}) {
  const colors = {
    blue: 'bg-blue-50 text-blue-700 border-blue-200',
    green: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    gray: 'bg-gray-50 text-gray-500 border-gray-200',
    yellow: 'bg-amber-50 text-amber-700 border-amber-200',
    red: 'bg-red-50 text-red-700 border-red-200',
  };

  return (
    <span
      className={`inline-block rounded-full border px-2 py-0.5 text-xs font-medium ${colors[color]}`}
    >
      {children}
    </span>
  );
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + '…' : s;
}

function formatTimestamp(ts?: string): string {
  if (!ts) return '—';
  try {
    return new Date(ts).toLocaleString('en-GB', {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return ts;
  }
}

function jsonSize(value: unknown): number {
  try {
    return JSON.stringify(value).length;
  } catch {
    return 0;
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function renderDebugStage(stage: string, payload: unknown) {
  if (payload === undefined || payload === null) return null;
  return (
    <details key={stage} className="rounded border border-gray-200 bg-gray-50">
      <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-gray-700">
        {stage} ({formatBytes(jsonSize(payload))})
      </summary>
      <pre className="max-h-72 overflow-auto border-t border-gray-200 bg-white p-3 text-xs whitespace-pre-wrap text-gray-700">
        {safeStringify(payload)}
      </pre>
    </details>
  );
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
