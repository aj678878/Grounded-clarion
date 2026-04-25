/* ------------------------------------------------------------------ */
/*  Sources-section helpers — used by the chat route to validate and  */
/*  enforce a deterministic Sources block at the end of an answer.    */
/* ------------------------------------------------------------------ */

export interface Source {
  title: string;
  url: string;
}

/** At least one markdown link [text](url). */
export function hasCitations(text: string): boolean {
  return /\[.+?\]\(https?:\/\/.+?\)/.test(text);
}

/**
 * Sources section is "valid" if:
 *   - no [1],[2],… numeric reference markers anywhere in the text
 *   - the last Sources/References header sits in the final 30% of the text
 *   - that trailing section contains at least one URL
 */
export function hasValidSourcesSection(text: string): boolean {
  if (/\[\d+\]/.test(text)) return false;

  const headerPattern = /(?:^|\n)\s*\**(?:Sources|Source|References)\**\s*:?/gi;
  let lastHeaderIndex = -1;
  let match: RegExpExecArray | null;
  while ((match = headerPattern.exec(text)) !== null) {
    lastHeaderIndex = match.index;
  }
  if (lastHeaderIndex < 0) return false;
  if (lastHeaderIndex < text.length * 0.7) return false;
  const sectionText = text.slice(lastHeaderIndex);
  return /https?:\/\/\S+/.test(sectionText);
}

export function stripExistingSourcesSection(text: string): string {
  const headerPattern = /(?:^|\n)\s*\**(?:Sources|Source|References)\**\s*:?/gi;
  let lastHeaderIndex = -1;
  let match: RegExpExecArray | null;
  while ((match = headerPattern.exec(text)) !== null) {
    lastHeaderIndex = match.index;
  }
  return lastHeaderIndex >= 0 ? text.slice(0, lastHeaderIndex).trimEnd() : text.trimEnd();
}

export function stripRawUrls(text: string): string {
  return text.replace(/https?:\/\/[^\s)\]]+/gi, '').replace(/[ \t]+\n/g, '\n').trimEnd();
}

/**
 * Replace any existing Sources/References block with a deterministic one
 * built from the supplied list. Dedupes by URL, caps at 5, drops invalid URLs.
 * Returns the original answer unchanged when `sources` is empty.
 */
export function enforceDeterministicSourcesSection(
  answer: string,
  sources: Source[]
): string {
  if (sources.length === 0) return answer;

  const seen = new Set<string>();
  const top = sources
    .filter((s) => typeof s.url === 'string' && s.url.startsWith('http'))
    .filter((s) => {
      if (seen.has(s.url)) return false;
      seen.add(s.url);
      return true;
    })
    .slice(0, 5)
    .map((s) => ({
      title: (s.title || 'Untitled source').replace(/\]/g, ''),
      url: s.url,
    }));

  if (top.length === 0) return stripRawUrls(stripExistingSourcesSection(answer));

  const body = stripRawUrls(stripExistingSourcesSection(answer));
  const sourcesBlock = `Sources:\n${top.map((s) => `- [${s.title}](${s.url})`).join('\n')}`;
  return body ? `${body}\n\n${sourcesBlock}` : sourcesBlock;
}
