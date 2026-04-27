'use client';

import { type ComponentProps } from 'react';
import ReactMarkdown from 'react-markdown';

function ExternalLink(props: ComponentProps<'a'>) {
  return <a {...props} target="_blank" rel="noopener noreferrer" />;
}

interface ChatBubbleProps {
  role: 'user' | 'assistant';
  content: string;
  sources?: { title: string; url: string }[];
  fromWebSearch?: boolean;
}

export default function ChatBubble({ role, content, sources = [], fromWebSearch }: ChatBubbleProps) {
  const isUser = role === 'user';

  return (
    <div className={`flex flex-col ${isUser ? 'items-end' : 'items-start'}`}>
      {/* Label above bubble */}
      <span
        className="font-ui uppercase mb-1"
        style={{ fontSize: '9.5px', fontWeight: 600, letterSpacing: '0.8px', color: 'var(--ink-3)' }}
      >
        {isUser ? 'You' : 'Clarion · Editorial'}
      </span>

      {/* Bubble */}
      <div
        className="font-body"
        style={{
          maxWidth: '88%',
          fontSize: '14px',
          lineHeight: 1.55,
          padding: isUser ? '11px 15px' : '12px 15px',
          background: isUser ? 'var(--accent)' : 'var(--paper-alt)',
          color: isUser ? '#FFFFFF' : 'var(--ink)',
          borderLeft: isUser ? 'none' : '3px solid var(--ink)',
          whiteSpace: isUser ? 'pre-wrap' : 'normal',
        }}
      >
        {isUser ? (
          content
        ) : (
          <div className="chat-markdown">
            <ReactMarkdown components={{ a: ExternalLink }}>{content}</ReactMarkdown>
          </div>
        )}
      </div>

      {/* ---- Sources footer (assistant only) ---- */}
      {!isUser && fromWebSearch !== undefined && (
        <div
          style={{
            maxWidth: '88%',
            width: '88%',
            marginTop: '6px',
            paddingTop: '8px',
            borderTop: '1px solid var(--border)',
          }}
        >
          {sources.length > 0 ? (
            <>
              <p
                className="font-ui uppercase"
                style={{ fontSize: '9px', fontWeight: 600, letterSpacing: '1.2px', color: 'var(--ink-3)', marginBottom: '6px' }}
              >
                Sources
              </p>
              <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '4px' }}>
                {sources.map((s, i) => (
                  <li key={i}>
                    <a
                      href={s.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-ui"
                      style={{
                        fontSize: '11px',
                        color: 'var(--accent)',
                        textDecoration: 'none',
                        display: 'flex',
                        alignItems: 'baseline',
                        gap: '4px',
                      }}
                    >
                      <span
                        style={{
                          fontSize: '9px',
                          fontWeight: 600,
                          color: 'var(--ink-3)',
                          flexShrink: 0,
                        }}
                      >
                        {i + 1}.
                      </span>
                      <span
                        style={{
                          textDecoration: 'underline',
                          textDecorationColor: 'var(--border)',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {s.title || new URL(s.url).hostname}
                      </span>
                      <span style={{ fontSize: '9px', flexShrink: 0, color: 'var(--ink-3)' }}>↗</span>
                    </a>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <span
              className="font-ui italic"
              style={{ fontSize: '10.5px', color: 'var(--ink-3)' }}
            >
              Answered from article context
            </span>
          )}
        </div>
      )}
    </div>
  );
}
