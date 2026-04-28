'use client';

import { useState, useRef, useCallback, useEffect } from 'react';

export type CompareState = 'idle' | 'loading' | 'done' | 'error';

export interface SourceStatus {
  source_id: number;
  name: string;
  status: 'queued' | 'fetching' | 'done' | 'failed';
}

export interface CompareResult {
  articleTitle: string;
  status: string;
  warnings: string[];
  total_duration_ms: number;
  payload: {
    phase1: unknown;
    phase2: { selected_sources: Array<{ source_id: number; source_name: string; source_domain: string; headline: string; url: string; published_at: string | null; snippet: string; tier: string; bias_lean: string }> };
    phase3: {
      sources_attempted: number;
      sources_used: number;
      extracted_sources: Array<{ source_id: number }>;
    };
    phase4: unknown;
  };
}

interface StatusResponse {
  status: 'pending' | 'running' | 'done' | 'error';
  currentPhase: number;
  sourceStatuses: SourceStatus[];
  result?: CompareResult;
  error?: string;
}

const POLL_INTERVAL_MS = 2000;

export function useCompareSources() {
  const [state, setState] = useState<CompareState>('idle');
  const [currentPhase, setCurrentPhase] = useState(0);
  const [sourceStatuses, setSourceStatuses] = useState<SourceStatus[]>([]);
  const [result, setResult] = useState<CompareResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const jobIdRef = useRef<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => stopPolling();
  }, [stopPolling]);

  const poll = useCallback(async () => {
    const jid = jobIdRef.current;
    if (!jid) return;

    try {
      const res = await fetch(`/api/compare-sources/status/${jid}`);
      if (!res.ok) throw new Error('Polling failed');
      const data: StatusResponse = await res.json();

      setCurrentPhase(data.currentPhase);
      setSourceStatuses(data.sourceStatuses);

      if (data.status === 'done' && data.result) {
        stopPolling();
        setResult(data.result);
        setState('done');
      } else if (data.status === 'error') {
        stopPolling();
        setError(data.error ?? 'Pipeline failed');
        setState('error');
      }
    } catch {
      // Transient fetch error — keep polling
    }
  }, [stopPolling]);

  const start = useCallback(
    async (input: {
      article_id: string;
      article_title: string;
      article_content: string;
      article_source_url: string;
      article_source_domain: string;
    }) => {
      stopPolling();
      setState('loading');
      setCurrentPhase(0);
      setSourceStatuses([]);
      setResult(null);
      setError(null);

      try {
        const res = await fetch('/api/compare-sources', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
        });

        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error ?? 'Failed to start');
        }

        const { jobId } = await res.json();
        jobIdRef.current = jobId;

        timerRef.current = setInterval(poll, POLL_INTERVAL_MS);
        // First poll immediately
        poll();
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to start pipeline';
        setError(msg);
        setState('error');
      }
    },
    [stopPolling, poll]
  );

  const retry = useCallback(() => {
    setState('idle');
    setError(null);
    setResult(null);
  }, []);

  return {
    state,
    currentPhase,
    sourceStatuses,
    result,
    error,
    start,
    retry,
  };
}
