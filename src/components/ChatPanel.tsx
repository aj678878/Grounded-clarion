'use client';

import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { ChatMessage } from '@/types';
import { getSessionId, generateThreadId } from '@/lib/session';
import ChatBubble from './ChatBubble';

interface ChatPanelProps {
  articleId: string;
  articleTitle?: string;
  articleText: string;
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

const STARTER_PROMPTS = [
  'What is the main argument here?',
  'Why does this matter?',
  'What background context am I missing?',
];

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

export default function ChatPanel({ articleId, articleTitle, articleText }: ChatPanelProps) {
  const [messages, setMessages] = useState<ExtMessage[]>([]);
  const [input, setInput] = useState('');
  const [threadId, setThreadId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryRequest, setRetryRequest] = useState<RetryRequest | null>(null);

  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const sessionId = useMemo(() => getSessionId(), []);

  useEffect(() => {
    const container = messagesContainerRef.current;
    if (container) container.scrollTop = container.scrollHeight;
  }, [messages, isLoading]);

  const submitRequest = useCallback(
    async (pending: RetryRequest) => {
      if (isLoading) return;

      const next = [...pending.previousMessages, pending.userMessage];
      setMessages(next);
      setInput('');
      setError(null);
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
          setError("I couldn't process this question reliably right now. Please retry.");
        } else if (msg.includes('LLM_TIMEOUT')) {
          setError('The AI took too long to respond. Please try again.');
        } else if (msg.includes('QUOTA_EXCEEDED')) {
          setError('API quota exceeded. Please try again later.');
        } else if (msg.includes('TOKEN_OVERFLOW')) {
          setError('Conversation limit reached. Start a new question or refresh the page.');
        } else {
          setError(msg);
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

  const showStarter = messages.length === 0 && !isLoading;

  return (
    <div className="flex h-full flex-col" style={{ background: 'var(--paper-card)' }}>
      {/* ---- Header ---- */}
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

      {/* ---- Messages — overscroll-behavior: contain stops scroll chaining into article ---- */}
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

        {error && (
          <div
            className="font-ui"
            style={{ fontSize: '12px', padding: '10px 12px', background: 'var(--paper-alt)', borderLeft: '3px solid var(--red)', color: 'var(--ink-2)' }}
          >
            {error}
            <button type="button" onClick={retryRequest ? handleRetry : handleSend} className="ml-2 underline" style={{ color: 'var(--accent)' }}>
              Retry
            </button>
          </div>
        )}
      </div>

      {/* ---- Composer ---- */}
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
