'use client';

import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import Button from './Button';

interface ChatBubbleProps {
  role: 'user' | 'assistant';
  content: string;
  /** Show Clear button (assistant messages only). */
  showClear?: boolean;
  onClear?: () => void;
}

export default function ChatBubble({ role, content, showClear, onClear }: ChatBubbleProps) {
  const [cleared, setCleared] = useState(false);

  const isUser = role === 'user';

  const handleClear = () => {
    setCleared(true);
    onClear?.();
  };

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div className="max-w-[85%]">
        {/* Label */}
        <p
          className={`mb-1 text-xs font-body font-medium ${
            isUser ? 'text-right text-gray-400' : 'text-gray-400'
          }`}
        >
          {isUser ? 'You' : 'Grounded'}
        </p>

        {/* Bubble */}
        <div
          className={
            'rounded-xl px-4 py-3 text-sm leading-relaxed font-body ' +
            (isUser
              ? 'bg-primary/5 text-gray-800 border border-primary/10 whitespace-pre-wrap'
              : 'bg-gray-50 text-gray-800 border border-gray-100')
          }
        >
          {isUser ? (
            content
          ) : (
            <div className="chat-markdown prose prose-sm prose-gray max-w-none
              prose-headings:font-headline prose-headings:text-gray-800 prose-headings:mt-3 prose-headings:mb-1.5
              prose-h2:text-sm prose-h2:font-bold
              prose-h3:text-sm prose-h3:font-semibold
              prose-p:my-1.5 prose-p:leading-relaxed
              prose-ul:my-1.5 prose-ul:pl-4
              prose-ol:my-1.5 prose-ol:pl-4
              prose-li:my-0.5
              prose-strong:text-gray-900
              prose-a:text-primary prose-a:underline prose-a:font-normal
              prose-blockquote:border-primary/30 prose-blockquote:text-gray-600
              prose-code:text-xs prose-code:bg-gray-100 prose-code:px-1 prose-code:rounded
              prose-hr:my-3 prose-hr:border-gray-200"
            >
              <ReactMarkdown>{content}</ReactMarkdown>
            </div>
          )}
        </div>

        {/* Clear button (assistant only) */}
        {!isUser && showClear && (
          <div className="mt-1.5 flex justify-start">
            {cleared ? (
              <span className="text-xs font-body text-emerald-600 flex items-center gap-1">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
                Cleared
              </span>
            ) : (
              <Button variant="clear" size="sm" onClick={handleClear}>
                Clear — I understand
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
