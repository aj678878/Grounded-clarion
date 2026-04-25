'use client';

import { type ComponentProps } from 'react';
import ReactMarkdown from 'react-markdown';

function ExternalLink(props: ComponentProps<'a'>) {
  return <a {...props} target="_blank" rel="noopener noreferrer" />;
}

interface ChatBubbleProps {
  role: 'user' | 'assistant';
  content: string;
}

export default function ChatBubble({ role, content }: ChatBubbleProps) {
  const isUser = role === 'user';

  return (
    <div className={`flex flex-col ${isUser ? 'items-end' : 'items-start'}`}>
      {/* Label above bubble */}
      <span
        className="font-ui uppercase mb-1"
        style={{
          fontSize: '9.5px',
          fontWeight: 600,
          letterSpacing: '0.8px',
          color: 'var(--ink-3)',
        }}
      >
        {isUser ? 'You' : 'Clarion · Editorial'}
      </span>

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
    </div>
  );
}
