import { extractDomain } from '@/lib/search';

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

export interface AnthropicDiscoveryCandidate {
  headline: string;
  url: string;
  source_domain: string;
  source_name: string;
  snippet: string;
  published_at: string | null;
}

export interface AnthropicDiscoveryResult {
  ok: boolean;
  error: string | null;
  raw_response: unknown;
  candidates: AnthropicDiscoveryCandidate[];
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export async function searchAnthropicWebForDiscovery(input: {
  query: string;
  model: string;
  maxUses?: number;
  blockedDomains?: readonly string[];
}): Promise<AnthropicDiscoveryResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { ok: false, error: 'ANTHROPIC_API_KEY not set', raw_response: null, candidates: [] };
  }

  const body = {
    model: input.model,
    max_tokens: 1024,
    messages: [
      {
        role: 'user',
        content: `Find up to 10 reputable news articles covering this same event. Focus on direct coverage, not commentary.\n\nQuery: ${input.query}`,
      },
    ],
    tools: [
      {
        type: 'web_search_20250305',
        name: 'web_search',
        max_uses: input.maxUses ?? 3,
        ...(input.blockedDomains && input.blockedDomains.length > 0
          ? { blocked_domains: input.blockedDomains }
          : {}),
      },
    ],
  };

  try {
    const res = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const rawText = await res.text();
    if (!res.ok) {
      return {
        ok: false,
        error: `Anthropic ${res.status}: ${rawText.slice(0, 300)}`,
        raw_response: rawText,
        candidates: [],
      };
    }

    const data = JSON.parse(rawText) as {
      content?: Array<Record<string, unknown>>;
    };

    const candidates: AnthropicDiscoveryCandidate[] = [];

    for (const block of data.content ?? []) {
      if (block.type !== 'server_tool_use') continue;
      const inputData = (block.input as Record<string, unknown>) ?? {};
      const results = Array.isArray(inputData.results) ? inputData.results : [];
      for (const row of results) {
        const item = row as Record<string, unknown>;
        const url = asString(item.url);
        const headline = asString(item.title);
        if (!url.startsWith('http') || !headline) continue;
        const sourceDomain = extractDomain(url);
        candidates.push({
          headline,
          url,
          source_domain: sourceDomain,
          source_name: sourceDomain,
          snippet: asString(item.page_result ?? item.text ?? item.snippet),
          published_at: asString(item.page_age) || null,
        });
      }
    }

    return {
      ok: true,
      error: null,
      raw_response: data,
      candidates,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      raw_response: null,
      candidates: [],
    };
  }
}
