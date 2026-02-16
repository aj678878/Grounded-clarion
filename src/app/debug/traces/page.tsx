/* ------------------------------------------------------------------ */
/*  /debug/traces — Chat trace viewer (observability)                 */
/*  Gated: only accessible in development or with ?key=debug query.   */
/* ------------------------------------------------------------------ */

import { redirect } from 'next/navigation';
import { getRecentTraces, type ChatTrace } from '@/lib/traces';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface PageProps {
  searchParams: { key?: string };
}

export default async function TracesPage({ searchParams }: PageProps) {
  // Light access gate: block in production unless ?key=debug
  const isProd = process.env.NODE_ENV === 'production';
  if (isProd && searchParams.key !== 'debug') {
    redirect('/');
  }

  const traces = await getRecentTraces(50);

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
