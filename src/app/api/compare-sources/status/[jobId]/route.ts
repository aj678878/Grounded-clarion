import { NextRequest, NextResponse } from 'next/server';
import { getJob } from '@/lib/synthesis/job-store';

export const runtime = 'nodejs';

export async function GET(
  _req: NextRequest,
  { params }: { params: { jobId: string } }
) {
  const job = getJob(params.jobId);

  if (!job) {
    return NextResponse.json(
      { status: 'error', error: 'Job not found' },
      { status: 404 }
    );
  }

  const response: Record<string, unknown> = {
    status: job.status,
    currentPhase: job.currentPhase,
    sourceStatuses: job.sourceStatuses,
  };

  if (job.status === 'done') {
    response.result = job.result;
  }

  if (job.status === 'error') {
    response.error = job.error;
  }

  return NextResponse.json(response);
}
