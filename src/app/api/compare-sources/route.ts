import { NextRequest, NextResponse } from 'next/server';
import { compareSourcesRequestSchema } from '@/lib/synthesis/schema';
import { runCompareSources } from '@/lib/synthesis/run';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = compareSourcesRequestSchema.parse(body);
    const result = await runCompareSources(parsed);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to compare sources';
    return NextResponse.json({ status: 'error', error: message }, { status: 400 });
  }
}
