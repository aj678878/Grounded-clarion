'use client';

import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { ChatMessage } from '@/types';
import { getSessionId, generateThreadId } from '@/lib/session';
import ChatBubble from './ChatBubble';
import DossierView from './DossierView';
import { useCompareSources, type SourceStatus, type CompareResult } from '@/hooks/useCompareSources';
import { ORIGINAL_ARTICLE_SOURCE_ID, type ComparativeSynthesis,
  type DegradedSynthesis,
  type DiscoveredSource } from '@/lib/synthesis/schema';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface ChatPanelProps {
  articleId: string;
  articleTitle?: string;
  articleText: string;
  articleSourceUrl: string;
  articleSourceDomain: string;
  articlePublishedAt?: string;
}

interface ExtMessage extends ChatMessage {
  threadId: string;
  sources?: { title: string; url: string }[];
  fromWebSearch?: boolean;
}

interface RetryRequest {
  requestBody: {
    session_id: string;
    article_id: string;
    article_title: string;
    articleText: string;
    chatHistory: { role: 'user' | 'assistant'; content: string }[];
    userMessage: string;
    thread_id: string;
  };
  previousMessages: ExtMessage[];
  userMessage: ExtMessage;
}

type SidebarView = 'chat' | 'dossier';

const STARTER_PROMPTS = [
  'What is the main argument here?',
  'Why does this matter?',
  'What background context am I missing?',
];

const PHASE_LABELS: Record<number, string> = {
  0: 'Starting…',
  1: 'Extracting event signature…',
  2: 'Discovering sources…',
  3: 'Fetching source content…',
  4: 'Synthesising dossier…',
};

/* ------------------------------------------------------------------ */
/*  Metric logger                                                      */
/* ------------------------------------------------------------------ */

async function logMetric(event: {
  session_id: string;
  article_id: string;
  thread_id: string;
  event_type: string;
}) {
  try {
    await fetch('/api/metric', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(event),
    });
  } catch {
    // best-effort
  }
}

/* ------------------------------------------------------------------ */
/*  Compare Sources button — 5 states                                  */
/* ------------------------------------------------------------------ */

function CompareSourcesButton({
  compareState,
  currentPhase,
  sourceStatuses,
  isPartial,
  sourcesUsed,
  sourcesAttempted,
  onStart,
  onViewDossier,
  onRetry,
}: {
  compareState: 'idle' | 'loading' | 'done' | 'error';
  currentPhase: number;
  sourceStatuses: SourceStatus[];
  isPartial: boolean;
  sourcesUsed: number;
  sourcesAttempted: number;
  onStart: () => void;
  onViewDossier: () => void;
  onRetry: () => void;
}) {
  if (compareState === 'idle') {
    return (
      <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)' }}>
        <button
          type="button"
          onClick={onStart}
          className="font-ui flex w-full items-center justify-center gap-1.5 uppercase"
          style={{
            fontSize: '10px',
            fontWeight: 600,
            letterSpacing: '0.7px',
            padding: '7px 12px',
            border: '1.5px solid var(--ink)',
            color: 'var(--ink)',
            background: 'transparent',
            cursor: 'pointer',
          }}
        >
          Compare Sources
          <span
            title="Queries 3–5 sources and synthesises a comparative dossier. ~12 sec."
            style={{ fontSize: '9px', opacity: 0.5, marginLeft: 'auto', cursor: 'help' }}
          >
            ⓘ
          </span>
        </button>
      </div>
    );
  }

  if (compareState === 'loading') {
    return (
      <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)' }}>
        <button
          type="button"
          disabled
          className="font-ui flex w-full items-center justify-center gap-1.5 uppercase"
          style={{
            fontSize: '10px',
            fontWeight: 600,
            letterSpacing: '0.7px',
            padding: '7px 12px',
            border: '1.5px solid var(--accent)',
            color: 'var(--accent)',
            background: 'rgba(27,58,92,0.04)',
            cursor: 'default',
          }}
        >
          Gathering Sources…
        </button>
        {/* Progress bar */}
        <div style={{ width: '100%', height: '3px', background: 'var(--border)', marginTop: '6px', overflow: 'hidden' }}>
          <div style={{ height: '100%', background: 'var(--accent)', width: '60%', animation: 'prog 2s ease-in-out infinite alternate' }} />
        </div>
        {/* Phase label */}
        <p className="font-ui" style={{ fontSize: '9px', color: 'var(--ink-3)', marginTop: '5px' }}>
          {PHASE_LABELS[currentPhase] ?? 'Processing…'}
        </p>
        {/* Per-source rows */}
        {sourceStatuses.length > 0 && (
          <div style={{ marginTop: '6px' }}>
            {sourceStatuses.map((s) => (
              <div
                key={s.source_id}
                className="font-ui flex items-center gap-2"
                style={{ fontSize: '10.5px', color: 'var(--ink-2)', padding: '3px 0', borderBottom: '1px dashed var(--border)' }}
              >
                <SourceDot status={s.status} />
                <span>{s.name}</span>
              </div>
            ))}
          </div>
        )}
        <p className="font-ui" style={{ fontSize: '9px', color: 'var(--ink-3)', fontStyle: 'italic', marginTop: '6px' }}>
          This usually takes about 12 seconds.
        </p>
      </div>
    );
  }

  if (compareState === 'done') {
    return (
      <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)' }}>
        <button
          type="button"
          onClick={onViewDossier}
          className="font-ui flex w-full items-center justify-center gap-1.5 uppercase"
          style={{
            fontSize: '10px',
            fontWeight: 600,
            letterSpacing: '0.7px',
            padding: '7px 12px',
            border: '1.5px solid var(--ink)',
            color: 'var(--paper)',
            background: 'var(--ink)',
            cursor: 'pointer',
          }}
        >
          View Dossier
        </button>
        {isPartial && (
          <div
            className="font-ui flex items-center gap-1.5 mt-1.5"
            style={{
              fontSize: '9.5px',
              color: '#8B5E00',
              background: '#FFF8E6',
              borderLeft: '2px solid #8B5E00',
              padding: '4px 8px',
            }}
          >
            Based on {sourcesUsed} of {sourcesAttempted} sources
          </div>
        )}
      </div>
    );
  }

  // error
  return (
    <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)' }}>
      <button
        type="button"
        onClick={onRetry}
        className="font-ui flex w-full items-center justify-center gap-1.5 uppercase"
        style={{
          fontSize: '10px',
          fontWeight: 600,
          letterSpacing: '0.7px',
          padding: '7px 12px',
          border: '1.5px solid var(--red)',
          color: 'var(--red)',
          background: 'transparent',
          cursor: 'pointer',
        }}
      >
        Try Again
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Source dot indicator                                                */
/* ------------------------------------------------------------------ */

function SourceDot({ status }: { status: SourceStatus['status'] }) {
  const size = '7px';
  const base: React.CSSProperties = { width: size, height: size, borderRadius: '50%', flexShrink: 0 };

  if (status === 'done') return <span style={{ ...base, background: '#2D6A4F' }} />;
  if (status === 'failed') return <span style={{ ...base, background: 'var(--red)' }} />;
  if (status === 'fetching') {
    return (
      <span
        style={{
          ...base,
          border: '1.5px solid var(--accent)',
          borderTopColor: 'transparent',
          background: 'transparent',
          animation: 'spin 0.9s linear infinite',
        }}
      />
    );
  }
  // queued
  return <span style={{ ...base, background: 'var(--border)' }} />;
}

/* ------------------------------------------------------------------ */
/*  Dossier header                                                     */
/* ------------------------------------------------------------------ */

function DossierHeader({
  sourcesUsed,
  sourcesAttempted,
  onBack,
}: {
  sourcesUsed: number;
  sourcesAttempted: number;
  onBack: () => void;
}) {
  return (
    <div
      className="flex-shrink-0 flex items-center justify-between"
      style={{ padding: '12px 16px', borderBottom: '2px solid var(--ink)', background: 'var(--paper-card)' }}
    >
      <button
        type="button"
        onClick={onBack}
        className="font-ui flex items-center gap-1"
        style={{
          fontSize: '9.5px',
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: '0.7px',
          color: 'var(--ink-3)',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          padding: 0,
        }}
      >
        ← Back to Chat
      </button>
      <div style={{ textAlign: 'right' }}>
        <p className="font-headline" style={{ fontSize: '13px', fontWeight: 700, color: 'var(--ink)' }}>
          Source Dossier
        </p>
        <p className="font-ui" style={{ fontSize: '9px', textTransform: 'uppercase', letterSpacing: '0.8px', color: 'var(--ink-3)', marginTop: '1px' }}>
          {sourcesUsed} of {sourcesAttempted} sources
        </p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main ChatPanel component                                           */
/* ------------------------------------------------------------------ */

export default function ChatPanel({
  articleId,
  articleTitle,
  articleText,
  articleSourceUrl,
  articleSourceDomain,
  articlePublishedAt,
}: ChatPanelProps) {
  const [messages, setMessages] = useState<ExtMessage[]>([]);
  const [input, setInput] = useState('');
  const [threadId, setThreadId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [retryRequest, setRetryRequest] = useState<RetryRequest | null>(null);
  const [sidebarView, setSidebarView] = useState<SidebarView>('chat');

  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const sessionId = useMemo(() => getSessionId(), []);

  const compare = useCompareSources();

  useEffect(() => {
    const container = messagesContainerRef.current;
    if (container) container.scrollTop = container.scrollHeight;
  }, [messages, isLoading]);

  /* ---- Chat logic (unchanged) ---- */

  const submitRequest = useCallback(
    async (pending: RetryRequest) => {
      if (isLoading) return;

      const next = [...pending.previousMessages, pending.userMessage];
      setMessages(next);
      setInput('');
      setChatError(null);
      setRetryRequest(null);
      setIsLoading(true);

      try {
        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(pending.requestBody),
        });

        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || `Request failed (${res.status})`);
        }

        const data = await res.json();
        const assistantMsg: ExtMessage = {
          role: 'assistant',
          content: data.assistantMessage,
          threadId: pending.requestBody.thread_id,
          sources: data.sources ?? [],
          fromWebSearch: data.fromWebSearch ?? false,
        };
        setMessages([...next, assistantMsg]);
        setRetryRequest(null);

        logMetric({
          session_id: sessionId,
          article_id: articleId,
          thread_id: pending.requestBody.thread_id,
          event_type: 'turn_added',
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Something went wrong';
        if (msg.includes('ROUTER_RETRYABLE')) {
          setChatError("I couldn't process this question reliably right now. Please retry.");
        } else if (msg.includes('LLM_TIMEOUT')) {
          setChatError('The AI took too long to respond. Please try again.');
        } else if (msg.includes('QUOTA_EXCEEDED')) {
          setChatError('API quota exceeded. Please try again later.');
        } else if (msg.includes('TOKEN_OVERFLOW')) {
          setChatError('Conversation limit reached. Start a new question or refresh the page.');
        } else {
          setChatError(msg);
        }
        setMessages(pending.previousMessages);
        setRetryRequest(pending);
      } finally {
        setIsLoading(false);
        inputRef.current?.focus();
      }
    },
    [isLoading, sessionId, articleId]
  );

  const sendMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || isLoading) return;

      let tid = threadId;
      if (!tid) {
        tid = generateThreadId();
        setThreadId(tid);
        logMetric({ session_id: sessionId, article_id: articleId, thread_id: tid, event_type: 'thread_started' });
      }

      const userMsg: ExtMessage = { role: 'user', content: trimmed, threadId: tid };
      const next = [...messages, userMsg];
      const threadHistory = next
        .filter((m) => m.threadId === tid)
        .slice(0, -1)
        .map(({ role, content }) => ({ role, content }));

      await submitRequest({
        requestBody: {
          session_id: sessionId,
          article_id: articleId,
          article_title: articleTitle ?? '',
          articleText,
          chatHistory: threadHistory,
          userMessage: trimmed,
          thread_id: tid,
        },
        previousMessages: messages,
        userMessage: userMsg,
      });
    },
    [isLoading, threadId, messages, sessionId, articleId, articleTitle, articleText, submitRequest]
  );

  const handleSend = useCallback(() => sendMessage(input), [sendMessage, input]);
  const handleRetry = useCallback(() => {
    if (retryRequest) void submitRequest(retryRequest);
  }, [retryRequest, submitRequest]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  /* ---- Compare Sources handlers ---- */

  const handleStartCompare = useCallback(() => {
    compare.start({
      article_id: articleId,
      article_title: articleTitle ?? '',
      article_content: articleText,
      article_source_url: articleSourceUrl,
      article_source_domain: articleSourceDomain,
      article_published_at: articlePublishedAt,
    });
  }, [compare, articleId, articleTitle, articleText, articleSourceUrl, articleSourceDomain, articlePublishedAt]);

  const handleViewDossier = useCallback(() => {
    setSidebarView('dossier');
  }, []);

  const handleBackToChat = useCallback(() => {
    setSidebarView('chat');
  }, []);

  /* ---- Derive dossier props from result ---- */

  const isNoComparison = compare.result?.status === 'no_comparison';

  const dossierProps = useMemo(() => {
    if (!compare.result) return null;
    const r = compare.result;
    if (r.status === 'no_comparison' || !r.payload.phase3 || !r.payload.phase4) return null;
    const peerSources = r.payload.phase2.selected_sources as DiscoveredSource[];
    const sources: DiscoveredSource[] = [
      {
        source_id: ORIGINAL_ARTICLE_SOURCE_ID,
        source_name: 'theguardian.com',
        source_domain: 'theguardian.com',
        headline: articleTitle ?? 'Guardian article',
        url: articleSourceUrl,
        published_at: articlePublishedAt ?? null,
        snippet: '',
        tier: 'tier1',
        bias_lean: 'center-left',
      },
      ...peerSources,
    ];
    const extractedSourceIds = [
      ORIGINAL_ARTICLE_SOURCE_ID,
      ...r.payload.phase3.extracted_sources.map((s: { source_id: number }) => s.source_id),
    ];
    return {
      synthesis: r.payload.phase4 as ComparativeSynthesis | DegradedSynthesis,
      sources,
      extractedSourceIds,
      sourcesAttempted: r.payload.phase3.sources_attempted,
      sourcesUsed: r.payload.phase3.sources_used,
      status: r.status,
      totalDurationMs: r.total_duration_ms,
    };
  }, [compare.result, articleTitle, articleSourceUrl, articlePublishedAt]);

  const showStarter = messages.length === 0 && !isLoading;

  /* ================================================================ */
  /*  NO-COMPARISON VIEW                                               */
  /* ================================================================ */

  if (sidebarView === 'dossier' && isNoComparison && compare.result) {
    return (
      <div className="flex h-full flex-col" style={{ background: 'var(--paper-card)' }}>
        <DossierHeader
          sourcesUsed={0}
          sourcesAttempted={compare.result.payload.phase2.candidates_considered ?? 0}
          onBack={handleBackToChat}
        />
        <div
          className="flex-1 min-h-0 overflow-y-auto chat-scroll"
          style={{ padding: '14px', overscrollBehavior: 'contain' }}
        >
          <div style={{ padding: '20px 0' }}>
            <p
              className="font-ui uppercase mb-3"
              style={{ fontSize: '10.5px', fontWeight: 600, letterSpacing: '1.8px', color: 'var(--red)' }}
            >
              No confident comparison available
            </p>
            <p
              className="font-body"
              style={{ fontSize: '12px', lineHeight: 1.65, color: 'var(--ink-2)', marginBottom: '12px' }}
            >
              We could not find enough reputable peer articles clearly covering the same event within the comparison window. Related coverage was found, but it appears to describe different incidents or time periods.
            </p>
            <p
              className="font-body italic"
              style={{ fontSize: '11px', lineHeight: 1.6, color: 'var(--ink-3)' }}
            >
              You can ask the Editor for background context or a broader analysis of this topic.
            </p>
            {compare.result.warnings.length > 0 && (
              <div className="mt-3 font-ui" style={{ fontSize: '9.5px', color: 'var(--ink-3)' }}>
                {compare.result.warnings.map((w: string, i: number) => (
                  <p key={i} style={{ marginBottom: '2px' }}>{w}</p>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  /* ================================================================ */
  /*  DOSSIER VIEW                                                     */
  /* ================================================================ */

  if (sidebarView === 'dossier' && dossierProps) {
    return (
      <div className="flex h-full flex-col" style={{ background: 'var(--paper-card)' }}>
        <DossierHeader
          sourcesUsed={dossierProps.sourcesUsed}
          sourcesAttempted={dossierProps.sourcesAttempted}
          onBack={handleBackToChat}
        />
        <div
          className="flex-1 min-h-0 overflow-y-auto chat-scroll"
          style={{ padding: '14px', overscrollBehavior: 'contain' }}
        >
          <DossierView {...dossierProps} />
        </div>
      </div>
    );
  }

  /* ================================================================ */
  /*  CHAT VIEW                                                        */
  /* ================================================================ */

  return (
    <div className="flex h-full flex-col" style={{ background: 'var(--paper-card)' }}>
      {/* Header */}
      <div
        className="flex-shrink-0"
        style={{ padding: '16px 20px 14px', borderBottom: '2px solid var(--ink)', background: 'var(--paper-card)' }}
      >
        <h2 className="font-headline" style={{ fontSize: '14px', fontWeight: 700, color: 'var(--ink)', lineHeight: 1.2 }}>
          Ask the Editor
        </h2>
        <p className="font-ui uppercase mt-1" style={{ fontSize: '10px', fontWeight: 600, letterSpacing: '1px', color: 'var(--ink-3)' }}>
          Clarion · Editorial AI
        </p>
      </div>

      {/* Compare Sources action row */}
      <CompareSourcesButton
        compareState={compare.state}
        currentPhase={compare.currentPhase}
        sourceStatuses={compare.sourceStatuses}
        isPartial={compare.result?.status === 'partial'}
        sourcesUsed={compare.result?.payload.phase3?.sources_used ?? 0}
        sourcesAttempted={compare.result?.payload.phase3?.sources_attempted ?? 0}
        onStart={handleStartCompare}
        onViewDossier={handleViewDossier}
        onRetry={() => { compare.retry(); }}
      />

      {/* Messages */}
      <div
        ref={messagesContainerRef}
        className="flex-1 min-h-0 overflow-y-auto chat-scroll"
        style={{
          padding: '18px',
          display: 'flex',
          flexDirection: 'column',
          gap: '14px',
          overscrollBehavior: 'contain',
        }}
      >
        {showStarter && (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 px-2 text-center">
            <p className="font-headline italic" style={{ fontSize: '17px', color: 'var(--ink-2)', lineHeight: 1.4 }}>
              Questions about this article?
            </p>
            <div className="flex flex-col gap-2 w-full">
              {STARTER_PROMPTS.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  onClick={() => sendMessage(prompt)}
                  className="font-body italic text-left transition-colors"
                  style={{ fontSize: '12.5px', background: 'var(--paper-alt)', border: '1px solid var(--border)', padding: '8px 14px', color: 'var(--ink-2)' }}
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <ChatBubble
            key={i}
            role={msg.role}
            content={msg.content}
            sources={msg.sources}
            fromWebSearch={msg.fromWebSearch}
          />
        ))}

        {isLoading && (
          <div className="flex justify-start">
            <div style={{ padding: '10px 14px', background: 'var(--paper-alt)' }}>
              <span className="ink-dot" />
              <span className="ink-dot" style={{ animationDelay: '0.15s' }} />
              <span className="ink-dot" style={{ animationDelay: '0.3s' }} />
            </div>
          </div>
        )}

        {chatError && (
          <div
            className="font-ui"
            style={{ fontSize: '12px', padding: '10px 12px', background: 'var(--paper-alt)', borderLeft: '3px solid var(--red)', color: 'var(--ink-2)' }}
          >
            {chatError}
            <button type="button" onClick={retryRequest ? handleRetry : handleSend} className="ml-2 underline" style={{ color: 'var(--accent)' }}>
              Retry
            </button>
          </div>
        )}
      </div>

      {/* Composer */}
      <div
        className="flex-shrink-0 flex gap-2"
        style={{ borderTop: '1px solid var(--border)', padding: '14px 16px', background: 'var(--paper-card)' }}
      >
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask a question…"
          disabled={isLoading}
          className="flex-1 font-body italic"
          style={{
            fontSize: '13px',
            border: '1px solid var(--border)',
            background: 'var(--paper)',
            color: 'var(--ink)',
            padding: '8px 10px',
            outline: 'none',
            borderRadius: 0,
          }}
          onFocus={(e) => (e.currentTarget.style.borderColor = 'var(--accent)')}
          onBlur={(e) => (e.currentTarget.style.borderColor = 'var(--border)')}
        />
        <button
          type="button"
          onClick={handleSend}
          disabled={isLoading || !input.trim()}
          className="font-ui uppercase"
          style={{
            fontSize: '11px',
            fontWeight: 600,
            letterSpacing: '0.7px',
            padding: '8px 16px',
            background: 'var(--ink)',
            color: 'var(--paper)',
            border: 'none',
            opacity: isLoading || !input.trim() ? 0.35 : 1,
            cursor: isLoading || !input.trim() ? 'not-allowed' : 'pointer',
          }}
        >
          Send
        </button>
      </div>
    </div>
  );
}
