'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { GuardianArticle, type Category } from '@/types';
import Masthead from '@/components/Masthead';
import NavBar from '@/components/NavBar';
import SectionRule from '@/components/SectionRule';
import Thumbnail from '@/components/Thumbnail';
import { ColCard, FlatCard } from '@/components/ArticleCard';
import LoadingState from '@/components/LoadingState';
import ErrorState from '@/components/ErrorState';

function bylineText(article: GuardianArticle): string {
  return article.byline?.trim() || 'Clarion Editorial Desk';
}

export default function FeedPage() {
  const [articles, setArticles] = useState<GuardianArticle[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Category>('All');
  const [searchQuery, setSearchQuery] = useState('');

  const fetchFeed = useCallback(
    async (pageNum: number, append: boolean = false, query: string = '') => {
      if (append) setIsLoadingMore(true);
      else setIsLoading(true);
      setError(null);

      try {
        const params = new URLSearchParams({ page: String(pageNum) });
        if (query) params.set('q', query);

        const res = await fetch(`/api/feed?${params}`, { cache: 'no-store' });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || `Failed to load feed (${res.status})`);
        }

        const data = await res.json();
        setArticles((prev) => (append ? [...prev, ...data.articles] : data.articles));
        setPage(pageNum);
        setHasMore(data.hasMore);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to load articles';
        if (msg.includes('QUOTA_EXCEEDED')) {
          setError('The Guardian API quota has been exceeded. Please try again later.');
        } else {
          setError(msg);
        }
      } finally {
        setIsLoading(false);
        setIsLoadingMore(false);
      }
    },
    []
  );

  useEffect(() => {
    fetchFeed(1, false, searchQuery);
  }, [fetchFeed, searchQuery]);

  const handleSearch = (query: string) => {
    setSearchQuery(query);
    setActiveTab('All');
    setArticles([]);
    setPage(1);
  };

  const handleTabChange = (tab: Category) => {
    if (searchQuery) {
      setSearchQuery('');
      setArticles([]);
      setPage(1);
    }
    setActiveTab(tab);
  };

  const handleLoadMore = () => {
    if (!isLoadingMore && hasMore) {
      fetchFeed(page + 1, true, searchQuery);
    }
  };

  const filteredArticles =
    activeTab === 'All' || searchQuery
      ? articles
      : articles.filter((a) => a.category.toLowerCase() === activeTab.toLowerCase());

  const showHero = !searchQuery && (activeTab === 'All' || activeTab === 'World');
  const heroArticle = showHero
    ? filteredArticles.find((a) => a.category.toLowerCase() === 'world') ?? filteredArticles[0]
    : null;
  const heroId = heroArticle?.id;
  const restArticles = heroId ? filteredArticles.filter((a) => a.id !== heroId) : filteredArticles;

  const worldArticles = restArticles.filter((a) => a.category.toLowerCase() === 'world');
  const businessArticles = restArticles.filter((a) => a.category.toLowerCase() === 'business');
  const techIndiaArticles = restArticles.filter(
    (a) => a.category.toLowerCase() === 'technology' || a.category.toLowerCase() === 'india'
  );

  return (
    <div className="min-h-screen" style={{ background: 'var(--paper)' }}>
      <Masthead />
      <NavBar
        active={activeTab}
        onChange={handleTabChange}
        searchQuery={searchQuery}
        onSearch={handleSearch}
      />

      <main className="mx-auto max-w-[1280px] px-4 py-8 sm:px-6">
        {isLoading ? (
          <LoadingState message="Setting today's edition…" />
        ) : error ? (
          <ErrorState message={error} onRetry={() => fetchFeed(1, false, searchQuery)} />
        ) : filteredArticles.length === 0 ? (
          <div className="py-20 text-center">
            <p className="font-body italic" style={{ color: 'var(--ink-3)' }}>
              {searchQuery
                ? `No articles found for "${searchQuery}".`
                : 'No articles in this category yet.'}
            </p>
          </div>
        ) : searchQuery ? (
          /* ---------- Search / filtered view: flat list ---------- */
          <>
            <div className="mb-5">
              <p
                className="font-ui uppercase"
                style={{
                  fontSize: '11px',
                  fontWeight: 600,
                  letterSpacing: '1px',
                  color: 'var(--red)',
                }}
              >
                Search results
              </p>
              <h2
                className="font-headline mt-1"
                style={{ fontSize: '28px', fontWeight: 700, color: 'var(--ink)' }}
              >
                Showing results for &ldquo;{searchQuery}&rdquo;
              </h2>
            </div>
            <div>
              {filteredArticles.map((article, i) => (
                <FlatCard key={article.id} article={article} index={i + 1} />
              ))}
            </div>
            {hasMore && (
              <div className="mt-8 flex justify-center">
                <button
                  type="button"
                  onClick={handleLoadMore}
                  disabled={isLoadingMore}
                  className="font-ui uppercase"
                  style={{
                    fontSize: '11px',
                    fontWeight: 600,
                    letterSpacing: '0.7px',
                    padding: '10px 20px',
                    background: 'var(--ink)',
                    color: 'var(--paper)',
                    opacity: isLoadingMore ? 0.4 : 1,
                  }}
                >
                  {isLoadingMore ? 'Loading…' : 'Load more'}
                </button>
              </div>
            )}
          </>
        ) : (
          <>
            {/* ---------- Hero (All / World only) ---------- */}
            {heroArticle && (
              <section
                className="grid gap-9 pb-10 mb-10"
                style={{
                  gridTemplateColumns: 'minmax(0, 1fr) 360px',
                  borderBottom: '2px solid var(--ink)',
                }}
              >
                <div className="min-w-0">
                  <p
                    className="font-ui uppercase"
                    style={{
                      fontSize: '10.5px',
                      fontWeight: 600,
                      letterSpacing: '1.5px',
                      color: 'var(--red)',
                    }}
                  >
                    {heroArticle.category} · Lead Story
                  </p>
                  <Link href={`/article/${heroArticle.id}`} className="block group mt-2">
                    <h2
                      className="font-headline transition-colors"
                      style={{
                        fontWeight: 700,
                        fontSize: 'clamp(26px, 3.8vw, 50px)',
                        lineHeight: 1.12,
                        color: 'var(--ink)',
                      }}
                    >
                      <span className="group-hover:[color:var(--accent)]">
                        {heroArticle.webTitle}
                      </span>
                    </h2>
                  </Link>
                  <p
                    className="font-ui uppercase mt-3"
                    style={{
                      fontSize: '11px',
                      fontWeight: 600,
                      letterSpacing: '0.8px',
                      color: 'var(--ink-3)',
                    }}
                  >
                    {bylineText(heroArticle)}
                  </p>
                  {heroArticle.trailText && (
                    <p
                      className="font-body italic mt-4"
                      style={{
                        fontSize: '16px',
                        lineHeight: 1.65,
                        color: 'var(--ink-2)',
                      }}
                      dangerouslySetInnerHTML={{ __html: heroArticle.trailText }}
                    />
                  )}
                  <Link
                    href={`/article/${heroArticle.id}`}
                    className="font-ui uppercase mt-6 inline-block transition-colors"
                    style={{
                      fontSize: '11.5px',
                      fontWeight: 600,
                      letterSpacing: '0.9px',
                      padding: '9px 22px',
                      background: 'var(--ink)',
                      color: 'var(--paper)',
                      borderRadius: 0,
                    }}
                  >
                    Read &amp; Discuss →
                  </Link>
                </div>
                <div className="hidden md:block">
                  <figure
                    style={{
                      border: '1px solid var(--border)',
                      background: 'var(--paper-alt)',
                    }}
                  >
                    <div style={{ aspectRatio: '4 / 5', overflow: 'hidden' }}>
                      <Thumbnail
                        src={heroArticle.thumbnail}
                        alt={heroArticle.webTitle}
                        sectionName={heroArticle.category}
                      />
                    </div>
                    <figcaption
                      className="font-ui uppercase px-3 py-1.5"
                      style={{
                        fontSize: '10px',
                        letterSpacing: '0.8px',
                        color: 'var(--ink-3)',
                        background: 'var(--paper-card)',
                        borderTop: '1px solid var(--border)',
                      }}
                    >
                      {heroArticle.category} · Lead photograph
                    </figcaption>
                  </figure>
                </div>
              </section>
            )}

            {/* ---------- Section divider ---------- */}
            <SectionRule label="Today's Edition" className="mb-8" />

            {/* ---------- 3-column grid (All) ---------- */}
            {activeTab === 'All' ? (
              <section className="grid gap-0 sm:grid-cols-3">
                <Column
                  label="World"
                  articles={worldArticles}
                  borderRight
                />
                <Column
                  label="Business"
                  articles={businessArticles}
                  borderRight
                />
                <Column
                  label="Tech & India"
                  articles={techIndiaArticles}
                />
              </section>
            ) : (
              /* Single-section tab: flat list */
              <section>
                {filteredArticles.map((article, i) => (
                  <FlatCard key={article.id} article={article} index={i + 1} />
                ))}
              </section>
            )}

            {/* Load more (only on All) */}
            {hasMore && (
              <div className="mt-10 flex justify-center">
                <button
                  type="button"
                  onClick={handleLoadMore}
                  disabled={isLoadingMore}
                  className="font-ui uppercase"
                  style={{
                    fontSize: '11px',
                    fontWeight: 600,
                    letterSpacing: '0.7px',
                    padding: '10px 22px',
                    background: 'var(--ink)',
                    color: 'var(--paper)',
                    opacity: isLoadingMore ? 0.4 : 1,
                  }}
                >
                  {isLoadingMore ? 'Loading…' : 'Load more'}
                </button>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}

function Column({
  label,
  articles,
  borderRight = false,
}: {
  label: string;
  articles: GuardianArticle[];
  borderRight?: boolean;
}) {
  return (
    <div
      className="px-0 sm:px-7 first:pl-0 last:pr-0"
      style={borderRight ? { borderRight: '1px solid var(--col-rule)' } : undefined}
    >
      <div className="flex items-center gap-3 mb-3">
        <span
          className="font-ui uppercase"
          style={{
            fontSize: '10px',
            fontWeight: 600,
            letterSpacing: '1.5px',
            color: 'var(--red)',
          }}
        >
          {label}
        </span>
        <span style={{ flex: 1, height: '1px', background: 'var(--red)' }} />
      </div>
      {articles.length === 0 ? (
        <p
          className="font-body italic py-4"
          style={{ fontSize: '13px', color: 'var(--ink-3)' }}
        >
          No stories in this section yet.
        </p>
      ) : (
        articles.map((a, i) => <ColCard key={a.id} article={a} index={i + 1} />)
      )}
    </div>
  );
}
