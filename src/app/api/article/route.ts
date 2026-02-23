/* ------------------------------------------------------------------ */
/*  GET /api/article?id=<guardianId> — fetch full article body        */
/* ------------------------------------------------------------------ */

import { NextRequest, NextResponse } from 'next/server';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { fetchArticle } from '@/lib/guardian';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id || id.trim().length === 0) {
      return NextResponse.json(
        { error: 'Missing required query parameter: id' },
        { status: 400 }
      );
    }

    const article = await fetchArticle(id);
    return NextResponse.json({ article });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to fetch article';

    if (message === 'Article not found') {
      return NextResponse.json({ error: message }, { status: 404 });
    }
    if (message.includes('QUOTA_EXCEEDED')) {
      return NextResponse.json({ error: 'API quota exceeded. Please try again later.' }, { status: 429 });
    }

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
