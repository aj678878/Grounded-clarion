'use client';

import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { ChatMessage } from '@/types';
import { getSessionId, generateThreadId } from '@/lib/session';
import ChatBubble from './ChatBubble';
import Button from './Button';

interface ChatPanelProps {
  articleId: string;
  articleTitle?: string;
  articleText: string;
}

/** Helper to log a metric event (fire-and-forget). */
async function logMetric(event: {
  session_id: string;
  article_id: string;
  thread_id: string;
  event_type: string;
  payload?: Record<string, unknown>;
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
  const [messages, setMessages] = useState<(ChatMessage & { threadId: string })[]>([]);
  const [input, setInput] = useState('');
  const [threadId, setThreadId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const sessionId = useMemo(() => getSessionId(), []);

  // Autoscroll the messages container to bottom on new messages
  useEffect(() => {
    const container = messagesContainerRef.current;
    if (container) {
      container.scrollTop = container.scrollHeight;
    }
  }, [messages, isLoading]);

  /* ---- Send message ---- */
  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || isLoading) return;

    setInput('');
    setError(null);

    // Start new thread if none active
    let tid = threadId;
    if (!tid) {
      tid = generateThreadId();
      setThreadId(tid);
      logMetric({
        session_id: sessionId,
        article_id: articleId,
        thread_id: tid,
        event_type: 'thread_started',
      });
    }

    const userMsg: ChatMessage & { threadId: string } = {
      role: 'user',
      content: text,
      threadId: tid,
    };
    const next = [...messages, userMsg];
    setMessages(next);
    setIsLoading(true);

    try {
      // Build chat history for this thread only
      const threadHistory = next
        .filter((m) => m.threadId === tid)
        .slice(0, -1) // exclude the message we just added
        .map(({ role, content }) => ({ role, content }));

      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: sessionId,
          article_id: articleId,
          article_title: articleTitle ?? '',
          articleText,
          chatHistory: threadHistory,
          userMessage: text,
          thread_id: tid,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Request failed (${res.status})`);
      }

      const data = await res.json();
      const assistantMsg: ChatMessage & { threadId: string } = {
        role: 'assistant',
        content: data.assistantMessage,
        threadId: tid,
      };
      setMessages([...next, assistantMsg]);

      logMetric({
        session_id: sessionId,
        article_id: articleId,
        thread_id: tid,
        event_type: 'turn_added',
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Something went wrong';
      if (msg.includes('LLM_TIMEOUT')) {
        setError('The AI took too long to respond. Please try again.');
      } else if (msg.includes('QUOTA_EXCEEDED')) {
        setError('API quota exceeded. Please try again later.');
      } else if (msg.includes('TOKEN_OVERFLOW')) {
        setError('Conversation limit reached. Please start a new question or refresh the page.');
      } else {
        setError(msg);
      }
      // Remove the user message on error
      setMessages(messages);
    } finally {
      setIsLoading(false);
      inputRef.current?.focus();
    }
  }, [input, isLoading, threadId, messages, sessionId, articleId, articleText]);

  /* ---- New question ---- */
  const handleNewQuestion = () => {
    setThreadId(null);
    setError(null);
    inputRef.current?.focus();
  };

  /* ---- Clear ---- */
  const handleClear = (tid: string) => {
    logMetric({
      session_id: sessionId,
      article_id: articleId,
      thread_id: tid,
      event_type: 'clear_clicked',
    });
  };

  /* ---- Key handler ---- */
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    /*
      This component expects its parent to set the height
      (e.g. the aside in ArticleView fills the viewport below the header).
      We use flex-col + h-full so:
        - header is pinned top
        - messages area scrolls
        - composer is pinned bottom
    */
    <div className="flex h-full flex-col">
      {/* ---- Chat header (pinned top) ---- */}
      <div className="flex-shrink-0 border-b border-gray-100 px-4 py-3">
        <h2 className="font-headline text-sm font-bold text-gray-800">
          Ask about this article
        </h2>
      </div>

      {/* ---- Scrollable messages area ---- */}
      <div
        ref={messagesContainerRef}
        className="flex-1 min-h-0 overflow-y-auto px-4 py-4 space-y-4 chat-scroll"
      >
        {messages.length === 0 && !isLoading && (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-primary/5 text-primary/40">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M18 10c0 3.866-3.582 7-8 7a8.841 8.841 0 01-4.083-.98L2 17l1.338-3.123C2.493 12.767 2 11.434 2 10c0-3.866 3.582-7 8-7s8 3.134 8 7zM7 9H5v2h2V9zm8 0h-2v2h2V9zM9 9h2v2H9V9z" clipRule="evenodd" />
              </svg>
            </div>
            <p className="text-sm text-gray-400 font-body max-w-[200px]">
              Ask a question to better understand this article.
            </p>
          </div>
        )}

        {/* Thread separator + messages */}
        {messages.map((msg, i) => {
          const prevThread = i > 0 ? messages[i - 1].threadId : null;
          const showSeparator = msg.threadId !== prevThread && i > 0;
          return (
            <div key={i}>
              {showSeparator && (
                <div className="my-4 flex items-center gap-2">
                  <div className="flex-1 border-t border-gray-200" />
                  <span className="text-xs text-gray-300 font-body">new question</span>
                  <div className="flex-1 border-t border-gray-200" />
                </div>
              )}
              <ChatBubble
                role={msg.role}
                content={msg.content}
                showClear={msg.role === 'assistant' && msg.threadId === threadId}
                onClear={() => handleClear(msg.threadId)}
              />
            </div>
          );
        })}

        {/* Typing indicator */}
        {isLoading && (
          <div className="flex justify-start">
            <div className="rounded-xl bg-gray-50 border border-gray-100 px-4 py-3">
              <div className="flex gap-1">
                <span className="h-2 w-2 rounded-full bg-gray-300 animate-bounce [animation-delay:0ms]" />
                <span className="h-2 w-2 rounded-full bg-gray-300 animate-bounce [animation-delay:150ms]" />
                <span className="h-2 w-2 rounded-full bg-gray-300 animate-bounce [animation-delay:300ms]" />
              </div>
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="rounded-lg border border-amber-100 bg-amber-50 px-3 py-2">
            <p className="text-sm text-amber-800 font-body">{error}</p>
            <button
              onClick={handleSend}
              className="mt-1 text-xs font-medium text-amber-700 underline hover:text-amber-900"
            >
              Retry
            </button>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* ---- Composer (pinned bottom) ---- */}
      <div className="flex-shrink-0 border-t border-gray-100 bg-white p-3 space-y-2">
        {threadId && (
          <button
            onClick={handleNewQuestion}
            className="w-full text-xs text-gray-400 hover:text-gray-600 font-body transition-colors py-1"
          >
            + New question
          </button>
        )}

        <div className="flex gap-2">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask a question…"
            disabled={isLoading}
            className="flex-1 rounded-md border border-gray-200 bg-white px-3 py-2 text-sm font-body text-gray-900 placeholder:text-gray-400 focus:border-primary/40 focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:opacity-50"
          />
          <Button onClick={handleSend} disabled={isLoading || !input.trim()} size="sm">
            Send
          </Button>
        </div>
      </div>
    </div>
  );
}
