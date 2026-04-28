export type SourceFetchStatus = 'queued' | 'fetching' | 'done' | 'failed';

export interface SourceProgress {
  source_id: number;
  name: string;
  status: SourceFetchStatus;
}

export interface Job {
  status: 'pending' | 'running' | 'done' | 'error';
  currentPhase: 0 | 1 | 2 | 3 | 4;
  sourceStatuses: SourceProgress[];
  result: unknown | null;
  error: string | null;
  createdAt: number;
}

const store = new Map<string, Job>();

const TTL_MS = 10 * 60 * 1000;

let sweepTimer: ReturnType<typeof setInterval> | null = null;

function ensureSweep() {
  if (sweepTimer) return;
  sweepTimer = setInterval(() => {
    const cutoff = Date.now() - TTL_MS;
    store.forEach((job, id) => {
      if (job.createdAt < cutoff) store.delete(id);
    });
    if (store.size === 0 && sweepTimer) {
      clearInterval(sweepTimer);
      sweepTimer = null;
    }
  }, 60_000);
}

export function createJob(id: string): void {
  store.set(id, {
    status: 'pending',
    currentPhase: 0,
    sourceStatuses: [],
    result: null,
    error: null,
    createdAt: Date.now(),
  });
  ensureSweep();
}

export function getJob(id: string): Job | undefined {
  return store.get(id);
}

export function updateJob(id: string, patch: Partial<Job>): void {
  const job = store.get(id);
  if (!job) return;
  Object.assign(job, patch);
}
