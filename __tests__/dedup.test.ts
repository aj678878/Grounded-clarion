import { normalizeTitle, deduplicateArticles } from '@/lib/dedup';
import { GuardianArticle } from '@/types';

/* ---- normalizeTitle ---- */

describe('normalizeTitle', () => {
  it('lowercases', () => {
    expect(normalizeTitle('Hello World')).toBe('hello world');
  });

  it('strips punctuation', () => {
    expect(normalizeTitle("It's a test — really!")).toBe('its a test really');
  });

  it('collapses whitespace', () => {
    expect(normalizeTitle('  lots   of   space  ')).toBe('lots of space');
  });

  it('handles empty string', () => {
    expect(normalizeTitle('')).toBe('');
  });

  it('treats differently-punctuated titles as equal', () => {
    const a = normalizeTitle('UK economy: whats next?');
    const b = normalizeTitle('UK economy whats next');
    expect(a).toBe(b);
  });
});

/* ---- deduplicateArticles ---- */

function makeArticle(overrides: Partial<GuardianArticle> = {}): GuardianArticle {
  return {
    id: 'test/article/1',
    webTitle: 'Test Article',
    webPublicationDate: '2024-01-01T00:00:00Z',
    sectionName: 'World',
    sectionId: 'world',
    webUrl: 'https://example.com',
    trailText: '',
    thumbnail: '',
    category: 'World',
    ...overrides,
  };
}

describe('deduplicateArticles', () => {
  it('removes exact duplicate titles', () => {
    const articles = [
      makeArticle({ id: '1', webTitle: 'Same Title' }),
      makeArticle({ id: '2', webTitle: 'Same Title' }),
    ];
    expect(deduplicateArticles(articles)).toHaveLength(1);
    expect(deduplicateArticles(articles)[0].id).toBe('1');
  });

  it('removes titles differing only in punctuation', () => {
    const articles = [
      makeArticle({ id: '1', webTitle: "UK's Economy" }),
      makeArticle({ id: '2', webTitle: 'UKs Economy' }),
    ];
    expect(deduplicateArticles(articles)).toHaveLength(1);
  });

  it('keeps distinct titles', () => {
    const articles = [
      makeArticle({ id: '1', webTitle: 'Alpha' }),
      makeArticle({ id: '2', webTitle: 'Beta' }),
      makeArticle({ id: '3', webTitle: 'Gamma' }),
    ];
    expect(deduplicateArticles(articles)).toHaveLength(3);
  });

  it('handles empty array', () => {
    expect(deduplicateArticles([])).toEqual([]);
  });
});
