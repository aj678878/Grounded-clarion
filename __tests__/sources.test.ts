import {
  hasCitations,
  hasValidSourcesSection,
  enforceDeterministicSourcesSection,
} from '@/lib/sources';

/* ---- hasCitations ---- */

describe('hasCitations', () => {
  it('detects a markdown link with http URL', () => {
    expect(hasCitations('See [BBC](https://bbc.co.uk) for more.')).toBe(true);
  });

  it('returns false for plain text without links', () => {
    expect(hasCitations('No citations here.')).toBe(false);
  });

  it('returns false for raw URLs without markdown link syntax', () => {
    expect(hasCitations('Visit https://example.com today')).toBe(false);
  });
});

/* ---- hasValidSourcesSection ---- */

const longBody = 'lorem ipsum '.repeat(40); // ~480 chars of body

describe('hasValidSourcesSection', () => {
  it('accepts a Sources block at the end with a URL', () => {
    const text =
      longBody +
      '\n\nSources:\n- [BBC](https://bbc.co.uk/news/article)';
    expect(hasValidSourcesSection(text)).toBe(true);
  });

  it('rejects when numeric markers like [1] appear in the body', () => {
    const text =
      longBody +
      ' here is a fact [1] and here is another [2].\n\nSources:\n- [BBC](https://bbc.co.uk)';
    expect(hasValidSourcesSection(text)).toBe(false);
  });

  it('rejects when no Sources header is present', () => {
    expect(hasValidSourcesSection('just an answer with no header')).toBe(false);
  });

  it('rejects when the Sources header sits in the first 70% of the text', () => {
    const text =
      'Sources:\n- [Early](https://example.com)\n\n' + longBody + longBody + longBody;
    expect(hasValidSourcesSection(text)).toBe(false);
  });

  it('rejects when the Sources section has no URL', () => {
    const text = longBody + '\n\nSources:\n- BBC reporting';
    expect(hasValidSourcesSection(text)).toBe(false);
  });

  it('accepts **Sources:** bold-header variant', () => {
    const text =
      longBody +
      '\n\n**Sources:**\n1. [Reuters](https://reuters.com/article)';
    expect(hasValidSourcesSection(text)).toBe(true);
  });
});

/* ---- enforceDeterministicSourcesSection ---- */

describe('enforceDeterministicSourcesSection', () => {
  const SRC = [
    { title: 'BBC', url: 'https://bbc.co.uk/a' },
    { title: 'Reuters', url: 'https://reuters.com/b' },
  ];

  it('returns the answer untouched when sources is empty', () => {
    const answer = 'Some prose.';
    expect(enforceDeterministicSourcesSection(answer, [])).toBe(answer);
  });

  it('appends a Sources block when none exists', () => {
    const out = enforceDeterministicSourcesSection('Some prose.', SRC);
    expect(out).toContain('Sources:\n- [BBC](https://bbc.co.uk/a)');
    expect(out).toContain('- [Reuters](https://reuters.com/b)');
    expect(out.startsWith('Some prose.')).toBe(true);
  });

  it('replaces an existing Sources block', () => {
    const original =
      'Some prose.\n\n**Sources:**\n1. [Old](https://old.example.com)';
    const out = enforceDeterministicSourcesSection(original, SRC);
    expect(out).not.toContain('Old');
    expect(out).not.toContain('old.example.com');
    expect(out).toContain('[BBC](https://bbc.co.uk/a)');
  });

  it('dedupes by URL', () => {
    const dups = [
      { title: 'BBC #1', url: 'https://bbc.co.uk/a' },
      { title: 'BBC #2', url: 'https://bbc.co.uk/a' },
      { title: 'Reuters', url: 'https://reuters.com/b' },
    ];
    const out = enforceDeterministicSourcesSection('body', dups);
    const matches = out.match(/bbc\.co\.uk\/a/g) ?? [];
    expect(matches).toHaveLength(1);
  });

  it('caps the list at 5 sources', () => {
    const many = Array.from({ length: 8 }, (_, i) => ({
      title: `T${i}`,
      url: `https://e${i}.com`,
    }));
    const out = enforceDeterministicSourcesSection('body', many);
    expect(out).toContain('https://e0.com');
    expect(out).toContain('https://e4.com');
    expect(out).not.toContain('https://e5.com');
    expect(out).not.toContain('https://e7.com');
  });

  it('drops sources with non-http URLs', () => {
    const mixed = [
      { title: 'OK', url: 'https://ok.example.com' },
      { title: 'Junk', url: 'not-a-url' },
      { title: 'JS', url: 'javascript:alert(1)' },
    ];
    const out = enforceDeterministicSourcesSection('body', mixed);
    expect(out).toContain('https://ok.example.com');
    expect(out).not.toContain('not-a-url');
    expect(out).not.toContain('javascript:');
  });

  it('substitutes "Untitled source" for blank titles', () => {
    const out = enforceDeterministicSourcesSection('body', [
      { title: '', url: 'https://example.com/x' },
    ]);
    expect(out).toContain('[Untitled source](https://example.com/x)');
  });

  it('strips raw URLs out of the answer body', () => {
    const out = enforceDeterministicSourcesSection(
      'See https://leak.example.com for context.',
      SRC
    );
    expect(out).not.toContain('https://leak.example.com');
    expect(out).toContain('See  for context.');
  });

  it('produces only the Sources block when the body strips to empty', () => {
    const out = enforceDeterministicSourcesSection(
      'Sources:\n- [Old](https://old.example.com)',
      SRC
    );
    expect(out.startsWith('Sources:')).toBe(true);
    expect(out).toContain('[BBC](https://bbc.co.uk/a)');
  });
});
