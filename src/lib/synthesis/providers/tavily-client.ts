import { extractDomain } from '@/lib/search';

export interface TavilyDiscoveryCandidate {
  headline: string;
  url: string;
  source_domain: string;
  source_name: string;
  snippet: string;
  published_at: string | null;
}

export interface TavilyDiscoveryResult {
  ok: boolean;
  timedOut: boolean;
  error: string | null;
  candidates: TavilyDiscoveryCandidate[];
  raw_response: unknown;
  request_payload: Record<string, unknown> | null;
}

export interface TavilyExtractSuccess {
  url: string;
  raw_content: string;
}

export interface TavilyExtractFailure {
  url: string;
  error: string;
}

export interface TavilyExtractResult {
  ok: boolean;
  timedOut: boolean;
  error: string | null;
  results: TavilyExtractSuccess[];
  failed_results: TavilyExtractFailure[];
  raw_response: unknown;
  request_payload: Record<string, unknown> | null;
}

const SEARCH_TIMEOUT_MS = 5_000;

function parsePublishedAt(row: Record<string, unknown>): string | null {
  const keys = ['published_date', 'published_at', 'date', 'page_age'];
  for (const key of keys) {
    const value = row[key];
    if (typeof value === 'string' && value.trim()) return value;
  }
  return null;
}

export async function searchTavilyForDiscovery(input: {
  query: string;
  maxResults?: number;
  includeDomains?: readonly string[];
}): Promise<TavilyDiscoveryResult> {
  const apiKey = process.env.TAVILY_API_KEY ?? '';
  if (!apiKey) {
    return {
      ok: false,
      timedOut: false,
      error: 'TAVILY_API_KEY not set',
      candidates: [],
      raw_response: null,
      request_payload: null,
    };
  }

  const payload = {
    api_key: apiKey,
    query: input.query,
    max_results: input.maxResults ?? 10,
    search_depth: 'advanced',
    ...(input.includeDomains && input.includeDomains.length > 0
      ? { include_domains: input.includeDomains }
      : {}),
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);

  try {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (!res.ok) {
      const errorBody = await res.text().catch(() => '');
      return {
        ok: false,
        timedOut: false,
        error: `Tavily ${res.status}: ${errorBody.slice(0, 300)}`,
        candidates: [],
        raw_response: errorBody,
        request_payload: payload,
      };
    }

    const data = (await res.json()) as { results?: Array<Record<string, unknown>> };
    const rows = Array.isArray(data.results) ? data.results : [];
    const candidates = rows
      .map((row) => {
        const url = typeof row.url === 'string' ? row.url : '';
        const headline = typeof row.title === 'string' ? row.title : '';
        const snippet =
          typeof row.snippet === 'string'
            ? row.snippet
            : typeof row.content === 'string'
            ? row.content
            : typeof row.description === 'string'
            ? row.description
            : '';
        const sourceDomain = extractDomain(url);
        return {
          headline,
          url,
          source_domain: sourceDomain,
          source_name: sourceDomain,
          snippet,
          published_at: parsePublishedAt(row),
        };
      })
      .filter((row) => row.url.startsWith('http') && row.headline);

    return {
      ok: true,
      timedOut: false,
      error: null,
      candidates,
      raw_response: data,
      request_payload: payload,
    };
  } catch (err) {
    const isAbort = err instanceof Error && err.name === 'AbortError';
    return {
      ok: false,
      timedOut: isAbort,
      error: isAbort ? 'Tavily timeout' : err instanceof Error ? err.message : String(err),
      candidates: [],
      raw_response: null,
      request_payload: payload,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function extractTavilyContent(input: {
  urls: string[];
  query?: string;
  timeoutSeconds?: number;
}): Promise<TavilyExtractResult> {
  const apiKey = process.env.TAVILY_API_KEY ?? '';
  if (!apiKey) {
    return {
      ok: false,
      timedOut: false,
      error: 'TAVILY_API_KEY not set',
      results: [],
      failed_results: [],
      raw_response: null,
      request_payload: null,
    };
  }

  const urls = input.urls.filter((url) => url.startsWith('http'));
  if (urls.length === 0) {
    return {
      ok: true,
      timedOut: false,
      error: null,
      results: [],
      failed_results: [],
      raw_response: null,
      request_payload: null,
    };
  }

  const payload: Record<string, unknown> = {
    urls,
    extract_depth: 'advanced',
    format: 'text',
    timeout: input.timeoutSeconds ?? 10,
  };
  if (input.query) {
    payload.query = input.query;
    payload.chunks_per_source = 5;
  }

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    Math.max(1000, (input.timeoutSeconds ?? 10) * 1000 + 500)
  );

  try {
    const res = await fetch('https://api.tavily.com/extract', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (!res.ok) {
      const errorBody = await res.text().catch(() => '');
      return {
        ok: false,
        timedOut: false,
        error: `Tavily extract ${res.status}: ${errorBody.slice(0, 300)}`,
        results: [],
        failed_results: [],
        raw_response: errorBody,
        request_payload: payload,
      };
    }

    const data = (await res.json()) as {
      results?: Array<Record<string, unknown>>;
      failed_results?: Array<Record<string, unknown>>;
    };

    const results = Array.isArray(data.results)
      ? data.results
          .map((row) => ({
            url: typeof row.url === 'string' ? row.url : '',
            raw_content: typeof row.raw_content === 'string' ? row.raw_content : '',
          }))
          .filter((row) => row.url.startsWith('http'))
      : [];

    const failed_results = Array.isArray(data.failed_results)
      ? data.failed_results
          .map((row) => ({
            url: typeof row.url === 'string' ? row.url : '',
            error: typeof row.error === 'string' ? row.error : 'Unknown Tavily extract error',
          }))
          .filter((row) => row.url.startsWith('http'))
      : [];

    return {
      ok: true,
      timedOut: false,
      error: null,
      results,
      failed_results,
      raw_response: data,
      request_payload: payload,
    };
  } catch (err) {
    const isAbort = err instanceof Error && err.name === 'AbortError';
    return {
      ok: false,
      timedOut: isAbort,
      error: isAbort ? 'Tavily extract timeout' : err instanceof Error ? err.message : String(err),
      results: [],
      failed_results: [],
      raw_response: null,
      request_payload: payload,
    };
  } finally {
    clearTimeout(timeout);
  }
}
