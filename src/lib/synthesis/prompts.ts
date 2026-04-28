export const EVENT_EXTRACTION_SYSTEM_PROMPT = `You are an event-signature extraction assistant for a multi-source news comparison workflow.

Your job is to convert a single news article into a compact event signature that will help retrieve matching coverage from other reputable outlets.

Return ONLY valid JSON that matches the requested schema.

Rules:
- Focus on the main event described by the article, not secondary details.
- key_actors must contain 2 to 5 named entities or clearly named institutions/groups.
- search_query should be 3 to 7 words, concise, and optimized for finding the same story elsewhere.
- time_window should be concrete when possible (for example "April 25-27 2026" or "late April 2026").
- regional_focus should be null unless the event clearly clusters in a region.
- Do not invent facts that are not supported by the article text.
- Prefer specific actors and locations over generic labels.
- If the article is ambiguous, choose the safest specific interpretation and keep the query broad enough to find matching coverage.`;

export function buildEventExtractionUserPrompt(args: {
  articleTitle: string;
  articleExcerpt: string;
}): string {
  return `Extract an event signature for the following article.

Article title:
${args.articleTitle}

Article body excerpt:
${args.articleExcerpt}

Return JSON with this exact shape:
{
  "event_type": "incident" | "policy" | "election" | "financial" | "scientific" | "geopolitical" | "sports" | "cultural" | "other",
  "key_actors": string[],
  "location": string | null,
  "time_window": string,
  "search_query": string,
  "regional_focus": "asia" | "europe" | "north_america" | "south_america" | "africa" | "middle_east" | "global" | null
}`;
}

export const EVENT_EXTRACTION_STRICT_APPEND = `Return ONLY a single valid minified JSON object that matches the schema exactly.
Do not add commentary, markdown, or extra keys.
If uncertain, make the safest valid choice instead of leaving fields blank.`;

export const SYNTHESIS_SYSTEM_PROMPT = `You are a comparative news synthesis assistant.

Your job is to compare the original article with a set of extracted source texts and produce a structured dossier.

Hard rules:
- Every entry in timeline, agreements, factual_disagreements, framing_and_labeling, and key_entities must cite valid source_ids.
- Every referenced source_id must exist in the provided source list.
- Factual disagreements are only for real conflicts about what happened. Do not invent them.
- Framing differences are only for meaningful differences in wording/labels for the same subject. Do not invent them.
- open_questions must be substantive factual gaps in the current reporting, not speculation.
- Do not use any information not supported by the provided sources.
- Keep summary to 1-2 sentences.
- If sources agree on facts, factual_disagreements should be [].
- If sources use materially similar labels, framing_and_labeling should be [].

Return ONLY valid JSON matching the requested schema.`;

export const SYNTHESIS_STRICT_APPEND = `Return ONLY one valid JSON object. No markdown, no prose, no code fences, no explanatory text.
Every source_id must refer to a source in the provided source list.
If uncertain, omit the claim instead of inventing support.`;

export function buildSynthesisUserPrompt(args: {
  articleTitle: string;
  articleContent: string;
  extractedSources: Array<{
    source_id: number;
    source_name: string;
    source_domain: string;
    headline: string;
    published_at: string | null;
    extraction_quality: string;
    content: string;
  }>;
  metadata: {
    sources_attempted: number;
    sources_used: number;
    apify_invocations: number;
    paywall_count: number;
    limited_coverage: boolean;
  };
}): string {
  const sourceList = args.extractedSources
    .map((source) => {
      return `SOURCE ${source.source_id}
name: ${source.source_name}
domain: ${source.source_domain}
headline: ${source.headline}
published_at: ${source.published_at ?? 'unknown'}
extraction_quality: ${source.extraction_quality}
content:
${source.content}`;
    })
    .join('\n\n');

  return `Create a comparative dossier for this article and source packet.

Original article title:
${args.articleTitle}

Original article content:
${args.articleContent}

Source packet:
${sourceList}

Run metadata:
${JSON.stringify(args.metadata, null, 2)}

Return JSON with this exact shape:
{
  "summary": string,
  "timeline": Array<{
    "datetime": string,
    "event": string,
    "source_ids": number[]
  }>,
  "agreements": Array<{
    "claim": string,
    "source_ids": number[]
  }>,
  "factual_disagreements": Array<{
    "topic": string,
    "positions": Array<{
      "source_id": number,
      "position": string
    }>
  }>,
  "framing_and_labeling": Array<{
    "subject": string,
    "labels_used": Array<{
      "source_id": number,
      "label": string
    }>,
    "interpretation": string
  }>,
  "key_entities": Array<{
    "name": string,
    "role": string,
    "source_ids": number[]
  }>,
  "open_questions": string[],
  "limited_coverage": boolean,
  "metadata": {
    "sources_attempted": number,
    "sources_used": number,
    "apify_invocations": number,
    "paywall_count": number
  }
}`;
}
