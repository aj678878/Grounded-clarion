/* ------------------------------------------------------------------ */
/*  GET /api/feed — balanced or search-based Guardian feed            */
/* ------------------------------------------------------------------ */

import { NextRequest, NextResponse } from 'next/server';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic'; // never statically cache this route

import { fetchBalancedFeed, searchFeed } from '@/lib/guardian';
import { deduplicateArticles } from '@/lib/dedup';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const query = searchParams.get('q')?.trim();

    let articles;
    if (query) {
      articles = await searchFeed(query, page);
    } else {
      articles = await fetchBalancedFeed(page);
    }

    articles = deduplicateArticles(articles);

    return NextResponse.json(
      {
        articles,
        page,
        hasMore: articles.length >= 20, // conservative: if we got ≥20 after dedup, probably more
      },
      {
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate',
        },
      }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to fetch feed';
    const status = message.includes('QUOTA_EXCEEDED') ? 429 : 500;
    return NextResponse.json(
      { error: message },
      { status, headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' } }
    );
  }
}
