/* ------------------------------------------------------------------ */
/*  POST /api/metric — log metric events to Vercel Postgres           */
/* ------------------------------------------------------------------ */

import { NextRequest, NextResponse } from 'next/server';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { insertMetricEvent } from '@/lib/db';
import { MetricEvent } from '@/types';

const VALID_EVENT_TYPES = new Set(['thread_started', 'turn_added', 'clear_clicked']);

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Partial<MetricEvent>;

    // ---- Validation ----
    if (!body.session_id || typeof body.session_id !== 'string') {
      return NextResponse.json({ error: 'Missing or invalid: session_id' }, { status: 400 });
    }
    if (!body.article_id || typeof body.article_id !== 'string') {
      return NextResponse.json({ error: 'Missing or invalid: article_id' }, { status: 400 });
    }
    if (!body.thread_id || typeof body.thread_id !== 'string') {
      return NextResponse.json({ error: 'Missing or invalid: thread_id' }, { status: 400 });
    }
    if (!body.event_type || !VALID_EVENT_TYPES.has(body.event_type)) {
      return NextResponse.json(
        { error: `Invalid event_type. Must be one of: ${Array.from(VALID_EVENT_TYPES).join(', ')}` },
        { status: 400 }
      );
    }

    const id = await insertMetricEvent({
      session_id: body.session_id,
      article_id: body.article_id,
      thread_id: body.thread_id,
      event_type: body.event_type as MetricEvent['event_type'],
      payload: body.payload,
    });

    return NextResponse.json({ id });
  } catch (err) {
    console.error('[/api/metric] Error:', err);
    return NextResponse.json(
      { error: 'Failed to log metric event' },
      { status: 500 }
    );
  }
}
