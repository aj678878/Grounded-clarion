'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { GuardianArticle, type Category } from '@/types';
import Header from '@/components/Header';
import Tabs from '@/components/Tabs';
import ArticleCard from '@/components/ArticleCard';
import Input from '@/components/Input';
import Button from '@/components/Button';
import LoadingState from '@/components/LoadingState';
import ErrorState from '@/components/ErrorState';

export default function FeedPage() {
  const [articles, setArticles] = useState<GuardianArticle[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Category>('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchInput, setSearchInput] = useState('');

  const loadMoreRef = useRef<HTMLDivElement>(null);

  /* ---- Fetch feed ---- */
  const fetchFeed = useCallback(
    async (pageNum: number, append: boolean = false) => {
      if (append) setIsLoadingMore(true);
      else setIsLoading(true);
      setError(null);

      try {
        const params = new URLSearchParams({ page: String(pageNum) });
        if (searchQuery) params.set('q', searchQuery);

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
    [searchQuery]
  );

  /* ---- Initial load ---- */
  useEffect(() => {
    fetchFeed(1);
  }, [fetchFeed]);

  /* ---- Search handler ---- */
  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setSearchQuery(searchInput.trim());
    setActiveTab('All');
    setArticles([]);
    setPage(1);
  };

  const clearSearch = () => {
    setSearchInput('');
    setSearchQuery('');
    setActiveTab('All');
    setArticles([]);
    setPage(1);
  };

  /* ---- Load more ---- */
  const handleLoadMore = () => {
    if (!isLoadingMore && hasMore) {
      fetchFeed(page + 1, true);
    }
  };

  /* ---- Filter by tab ---- */
  const filteredArticles =
    activeTab === 'All'
      ? articles
      : articles.filter((a) => a.category.toLowerCase() === activeTab.toLowerCase());

  return (
    <div className="min-h-screen">
      <Header />

      <main className="mx-auto max-w-4xl px-4 py-6 sm:px-6">
        {/* Title */}
        <div className="mb-6">
          <h2 className="font-headline text-2xl font-bold text-gray-900 sm:text-3xl">
            Today&apos;s reading
          </h2>
          <p className="mt-1 font-body text-sm text-gray-500">
            Browse articles, then read &amp; discuss with AI-powered context.
          </p>
        </div>

        {/* Search */}
        <form onSubmit={handleSearch} className="mb-4 flex gap-2">
          <Input
            label="Search topics"
            placeholder="Search topics…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
          <Button type="submit" size="sm">
            Search
          </Button>
          {searchQuery && (
            <Button type="button" variant="ghost" size="sm" onClick={clearSearch}>
              Clear
            </Button>
          )}
        </form>

        {/* Search indicator */}
        {searchQuery && (
          <p className="mb-4 text-sm font-body text-gray-500">
            Showing results for &ldquo;<span className="font-medium text-gray-700">{searchQuery}</span>&rdquo;
          </p>
        )}

        {/* Tabs (hidden during search) */}
        {!searchQuery && <Tabs active={activeTab} onChange={setActiveTab} />}

        {/* Content */}
        <div className="mt-5">
          {isLoading ? (
            <LoadingState message="Fetching articles…" />
          ) : error ? (
            <ErrorState message={error} onRetry={() => fetchFeed(1)} />
          ) : filteredArticles.length === 0 ? (
            <div className="py-16 text-center">
              <p className="text-sm text-gray-400 font-body">
                {searchQuery
                  ? 'No articles found for this search.'
                  : 'No articles in this category.'}
              </p>
            </div>
          ) : (
            <>
              <div className="space-y-3">
                {filteredArticles.map((article) => (
                  <ArticleCard key={article.id} article={article} />
                ))}
              </div>

              {/* Load more */}
              {hasMore && activeTab === 'All' && (
                <div ref={loadMoreRef} className="mt-6 flex justify-center">
                  <Button
                    variant="secondary"
                    onClick={handleLoadMore}
                    disabled={isLoadingMore}
                  >
                    {isLoadingMore ? 'Loading…' : 'Load 30 more'}
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      </main>
    </div>
  );
}
