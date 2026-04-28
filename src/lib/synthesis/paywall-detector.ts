function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function isPaywalled(content: string, title: string): boolean {
  if (!content || content.trim().length < 200) return true;

  const paywallPatterns = [
    /subscribe\s+to\s+continue/i,
    /this\s+content\s+is\s+for\s+subscribers/i,
    /sign\s+(up|in)\s+to\s+read/i,
    /already\s+a\s+subscriber/i,
    /get\s+(unlimited|full)\s+access/i,
    /create\s+(a\s+)?free\s+account/i,
    /democracy\s+dies\s+in\s+darkness/i,
    /article\s+printing\s+is\s+available\s+to\s+subscribers\s+only/i,
    /zen\s+reading\s+is\s+available\s+to\s+subscribers\s+only/i,
  ];

  if (paywallPatterns.some((pattern) => pattern.test(content))) return true;

  const titleProbe = title.trim().slice(0, 30);
  if (titleProbe.length >= 8) {
    const titleOccurrences =
      content.match(new RegExp(escapeRegExp(titleProbe), 'gi'))?.length ?? 0;
    if (titleOccurrences > 2 && content.length < 600) return true;
  }

  return false;
}

export function countWords(text: string): number {
  return text
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}
