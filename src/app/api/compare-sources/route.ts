import { NextRequest, NextResponse } from 'next/server';
import { compareSourcesRequestSchema } from '@/lib/synthesis/schema';
import { runCompareSourcesAsync } from '@/lib/synthesis/run';
import { createJob } from '@/lib/synthesis/job-store';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = compareSourcesRequestSchema.parse(body);

    const jobId = crypto.randomUUID();
    createJob(jobId);

    // Fire-and-forget — do NOT await
    runCompareSourcesAsync(parsed, jobId).catch(() => {
      /* errors are written to the job store */
    });

    return NextResponse.json({ jobId });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to start compare sources';
    return NextResponse.json({ status: 'error', error: message }, { status: 400 });
  }
}
