'use client';

import { useState } from 'react';
import type {
  ComparativeSynthesis,
  DegradedSynthesis,
  DiscoveredSource,
} from '@/lib/synthesis/schema';

/* ------------------------------------------------------------------ */
/*  Props                                                              */
/* ------------------------------------------------------------------ */

export interface DossierViewProps {
  synthesis: ComparativeSynthesis | DegradedSynthesis;
  sources: DiscoveredSource[];
  extractedSourceIds: number[];
  sourcesAttempted: number;
  sourcesUsed: number;
  status: string;
  totalDurationMs: number;
}

/* ------------------------------------------------------------------ */
/*  Type guard                                                         */
/* ------------------------------------------------------------------ */

function isStructured(
  s: ComparativeSynthesis | DegradedSynthesis
): s is ComparativeSynthesis {
  return !('synthesis_quality' in s);
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function biasLabel(lean: DiscoveredSource['bias_lean']): string {
  const MAP: Record<string, string> = {
    left: 'Left',
    'lean-left': 'Lean Left',
    'center-left': 'Centre-Left',
    center: 'Centre',
    'center-right': 'Centre-Right',
    'lean-right': 'Lean Right',
    right: 'Right',
    unknown: '',
  };
  return MAP[lean] ?? '';
}

function sourceName(sources: DiscoveredSource[], id: number): string {
  return sources.find((s) => s.source_id === id)?.source_name ?? `Source ${id}`;
}

function sourceNames(sources: DiscoveredSource[], ids: number[]): string {
  return ids.map((id) => sourceName(sources, id)).join(', ');
}

/* ------------------------------------------------------------------ */
/*  Inline citation — [Reuters, AP] named chip style                   */
/* ------------------------------------------------------------------ */

function Cites({
  sources,
  ids,
}: {
  sources: DiscoveredSource[];
  ids: number[];
}) {
  return (
    <span
      className="font-ui"
      style={{
        fontSize: '9.5px',
        fontWeight: 600,
        letterSpacing: '0.3px',
        color: 'var(--ink-3)',
        marginLeft: '5px',
      }}
    >
      [{sourceNames(sources, ids)}]
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  Partial-coverage banner                                            */
/* ------------------------------------------------------------------ */

function PartialBanner({
  sourcesUsed,
  sourcesAttempted,
}: {
  sourcesUsed: number;
  sourcesAttempted: number;
}) {
  const missing = sourcesAttempted - sourcesUsed;
  if (missing <= 0) return null;
  return (
    <div
      className="font-ui mb-4"
      style={{
        background: '#FBF7EC',
        borderLeft: '2px solid #D4B96A',
        padding: '8px 12px',
        fontSize: '11px',
        color: '#5C4A1A',
        lineHeight: 1.6,
      }}
    >
      Based on <strong>{sourcesUsed}</strong> of <strong>{sourcesAttempted}</strong> source
      {sourcesAttempted !== 1 ? 's' : ''} —{' '}
      {missing} outlet{missing !== 1 ? 's were' : ' was'} unavailable or paywalled.
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Accordion shell                                                    */
/* ------------------------------------------------------------------ */

function AccordionSection({
  number,
  label,
  preview,
  isOpen,
  onToggle,
  children,
}: {
  number: string;
  label: string;
  preview?: string;
  isOpen: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div style={{ borderBottom: '1px solid var(--border)' }}>
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-2 py-2.5 text-left"
        style={{ background: isOpen ? 'rgba(27,58,92,0.03)' : 'none', border: 'none', cursor: 'pointer', padding: '9px 0' }}
      >
        <span
          className="font-ui flex-shrink-0"
          style={{
            fontSize: '8.5px',
            fontWeight: 700,
            color: 'var(--ink-3)',
            width: '18px',
            letterSpacing: '0.5px',
          }}
        >
          {number}
        </span>
        <span
          className="font-headline flex-1"
          style={{ fontSize: '12px', fontWeight: 700, color: 'var(--ink)' }}
        >
          {label}
        </span>
        {preview && !isOpen && (
          <span
            className="font-ui"
            style={{
              fontSize: '9.5px',
              color: 'var(--ink-3)',
              fontStyle: 'italic',
              maxWidth: '80px',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {preview}
          </span>
        )}
        <span
          style={{
            fontSize: '11px',
            color: 'var(--ink-3)',
            transform: isOpen ? 'rotate(90deg)' : 'none',
            transition: 'transform 0.15s ease',
            display: 'inline-block',
          }}
        >
          ›
        </span>
      </button>
      {isOpen && (
        <div style={{ paddingBottom: '14px', paddingLeft: '22px', borderTop: '1px dashed var(--border)' }}>
          {children}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Section content components                                         */
/* ------------------------------------------------------------------ */

function Timeline({
  items,
  sources,
}: {
  items: ComparativeSynthesis['timeline'];
  sources: DiscoveredSource[];
}) {
  if (items.length === 0) return <p className="font-body italic" style={{ fontSize: '11px', color: 'var(--ink-3)' }}>No timeline events recorded.</p>;
  return (
    <ol className="space-y-2.5 mt-2">
      {items.map((item, i) => (
        <li key={i}>
          <span
            className="font-ui block"
            style={{ fontSize: '9.5px', fontWeight: 700, color: 'var(--ink)', marginBottom: '1px' }}
          >
            {item.datetime}
          </span>
          <span
            className="font-body"
            style={{ fontSize: '11px', lineHeight: 1.6, color: 'var(--ink-2)' }}
          >
            {item.event}
            <Cites sources={sources} ids={item.source_ids} />
          </span>
        </li>
      ))}
    </ol>
  );
}

function Agreements({
  items,
  sources,
}: {
  items: ComparativeSynthesis['agreements'];
  sources: DiscoveredSource[];
}) {
  if (items.length === 0) return null;
  return (
    <ul className="space-y-2 mt-2">
      {items.map((item, i) => (
        <li key={i} className="flex items-baseline gap-1.5">
          <span style={{ color: 'var(--red)', fontWeight: 700, flexShrink: 0, fontSize: '10px' }}>·</span>
          <span
            className="font-body"
            style={{ fontSize: '11px', lineHeight: 1.6, color: 'var(--ink-2)' }}
          >
            {item.claim}
            <Cites sources={sources} ids={item.source_ids} />
          </span>
        </li>
      ))}
    </ul>
  );
}

function FactualDisagreements({
  items,
  sources,
}: {
  items: ComparativeSynthesis['factual_disagreements'];
  sources: DiscoveredSource[];
}) {
  if (items.length === 0) return null;
  return (
    <div className="space-y-4 mt-2">
      {items.map((item, i) => (
        <div key={i}>
          <p
            className="font-ui uppercase mb-1.5"
            style={{ fontSize: '9px', fontWeight: 600, letterSpacing: '1px', color: 'var(--ink-2)' }}
          >
            {item.topic}
          </p>
          <ul
            className="space-y-1 pl-2.5"
            style={{ borderLeft: '2px solid var(--border)' }}
          >
            {item.positions.map((pos, j) => (
              <li
                key={j}
                className="font-body"
                style={{ fontSize: '11px', lineHeight: 1.6, color: 'var(--ink-2)' }}
              >
                <span
                  className="font-ui"
                  style={{ fontSize: '9.5px', fontWeight: 600, color: 'var(--ink-3)', marginRight: '4px' }}
                >
                  {sourceName(sources, pos.source_id)}:
                </span>
                {pos.position}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function FramingAndLabelling({
  items,
  sources,
}: {
  items: ComparativeSynthesis['framing_and_labeling'];
  sources: DiscoveredSource[];
}) {
  if (items.length === 0) return null;
  return (
    <div className="space-y-4 mt-2">
      {items.map((item, i) => (
        <div key={i}>
          <p
            className="font-ui uppercase mb-1.5"
            style={{ fontSize: '9px', fontWeight: 600, letterSpacing: '1px', color: 'var(--ink-2)' }}
          >
            {item.subject}
          </p>
          <ul
            className="space-y-1 pl-2.5 mb-1.5"
            style={{ borderLeft: '2px solid var(--border)' }}
          >
            {item.labels_used.map((lbl, j) => (
              <li
                key={j}
                className="font-body"
                style={{ fontSize: '11px', lineHeight: 1.6, color: 'var(--ink-2)' }}
              >
                <span
                  className="font-ui"
                  style={{ fontSize: '9.5px', fontWeight: 600, color: 'var(--ink-3)', marginRight: '4px' }}
                >
                  {sourceName(sources, lbl.source_id)}:
                </span>
                &ldquo;{lbl.label}&rdquo;
              </li>
            ))}
          </ul>
          <p
            className="font-body italic"
            style={{ fontSize: '10.5px', color: 'var(--ink-3)', lineHeight: 1.5 }}
          >
            {item.interpretation}
          </p>
        </div>
      ))}
    </div>
  );
}

function KeyEntities({
  items,
  sources,
}: {
  items: ComparativeSynthesis['key_entities'];
  sources: DiscoveredSource[];
}) {
  if (items.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2 mt-2">
      {items.map((entity, i) => (
        <div
          key={i}
          className="font-ui"
          style={{
            border: '1px solid var(--border)',
            background: 'var(--paper-alt)',
            padding: '5px 8px',
          }}
        >
          <p style={{ fontSize: '10.5px', fontWeight: 600, color: 'var(--ink)' }}>
            {entity.name}
          </p>
          <p style={{ fontSize: '9px', color: 'var(--ink-3)', marginTop: '1px' }}>
            {entity.role}
          </p>
          <p style={{ fontSize: '8.5px', color: 'var(--ink-3)', marginTop: '2px' }}>
            {entity.source_ids.map((id) => sourceName(sources, id)).join(', ')}
          </p>
        </div>
      ))}
    </div>
  );
}

function OpenQuestions({ questions }: { questions: string[] }) {
  if (questions.length === 0) return null;
  return (
    <ol className="space-y-2 mt-2" style={{ listStyleType: 'decimal', paddingLeft: '16px' }}>
      {questions.map((q, i) => (
        <li
          key={i}
          className="font-body"
          style={{ fontSize: '11px', lineHeight: 1.6, color: 'var(--ink-2)' }}
        >
          {q}
        </li>
      ))}
    </ol>
  );
}

/* ------------------------------------------------------------------ */
/*  Bottom source list                                                 */
/* ------------------------------------------------------------------ */

function SourceList({
  sources,
  extractedSourceIds,
}: {
  sources: DiscoveredSource[];
  extractedSourceIds: number[];
}) {
  const extractedSet = new Set(extractedSourceIds);

  return (
    <div style={{ borderTop: '2px solid var(--ink)', paddingTop: '12px', marginTop: '16px' }}>
      <p
        className="font-ui uppercase mb-3"
        style={{
          fontSize: '8.5px',
          fontWeight: 700,
          letterSpacing: '1.5px',
          color: 'var(--ink-3)',
        }}
      >
        Sources Consulted
      </p>
      <div className="space-y-3">
        {sources.map((source) => {
          const available = extractedSet.has(source.source_id);
          const bias = biasLabel(source.bias_lean);
          const pubDate = source.published_at
            ? new Date(source.published_at).toLocaleDateString('en-GB', {
                day: 'numeric',
                month: 'short',
                year: 'numeric',
              })
            : null;

          return (
            <div
              key={source.source_id}
              className="flex gap-2"
              style={{ opacity: available ? 1 : 0.45, padding: '4px 0', borderBottom: '1px solid var(--border)' }}
            >
              <span
                className="font-ui flex-shrink-0"
                style={{ fontSize: '8px', fontWeight: 700, color: 'var(--accent)', width: '12px', marginTop: '1px' }}
              >
                {source.source_id}
              </span>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span
                    className="font-ui"
                    style={{
                      fontSize: '9.5px',
                      fontWeight: 700,
                      color: 'var(--ink)',
                      textTransform: 'uppercase',
                      letterSpacing: '0.5px',
                    }}
                  >
                    {source.source_name}
                  </span>
                  {bias && (
                    <span
                      className="font-ui"
                      style={{ fontSize: '8px', padding: '1px 4px', border: '1px solid var(--border)', color: 'var(--ink-3)' }}
                    >
                      {bias}
                    </span>
                  )}
                  {!available && (
                    <span
                      className="font-ui"
                      style={{ fontSize: '8px', padding: '1px 4px', border: '1px solid #D4B96A', color: '#7A5A00', background: '#FBF7EC' }}
                    >
                      unavailable
                    </span>
                  )}
                </div>
                <a
                  href={source.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-body italic hover:underline block"
                  style={{ fontSize: '10px', color: 'var(--ink-2)', lineHeight: 1.4, marginTop: '1px' }}
                >
                  {source.headline}
                </a>
                {pubDate && (
                  <span className="font-ui" style={{ fontSize: '9px', color: 'var(--ink-3)' }}>
                    {pubDate}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Degraded fallback                                                  */
/* ------------------------------------------------------------------ */

function DegradedView({ text }: { text: string }) {
  return (
    <div
      className="font-body mb-4"
      style={{
        fontSize: '11px',
        lineHeight: 1.65,
        color: 'var(--ink-2)',
        whiteSpace: 'pre-wrap',
        background: 'var(--paper-alt)',
        border: '1px solid var(--border)',
        padding: '10px 12px',
      }}
    >
      {text}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main DossierView component                                         */
/* ------------------------------------------------------------------ */

export default function DossierView({
  synthesis,
  sources,
  extractedSourceIds,
  sourcesAttempted,
  sourcesUsed,
  status,
  totalDurationMs,
}: DossierViewProps) {
  const [open, setOpen] = useState<Set<string>>(new Set(['timeline']));

  function toggle(id: string) {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const structured = isStructured(synthesis);

  return (
    <div>
      {/* Partial coverage banner */}
      <PartialBanner sourcesUsed={sourcesUsed} sourcesAttempted={sourcesAttempted} />

      {/* Summary — always visible, outside accordion */}
      {structured ? (
        <div className="mb-4">
          <p
            className="font-body italic"
            style={{ fontSize: '12px', lineHeight: 1.65, color: 'var(--ink)' }}
          >
            {synthesis.summary}
          </p>
        </div>
      ) : (
        <>
          <DegradedView text={synthesis.raw_text} />
          <p
            className="font-ui mb-4"
            style={{ fontSize: '9.5px', color: 'var(--ink-3)', fontStyle: 'italic' }}
          >
            Structured dossier unavailable — showing best-effort plain text.
          </p>
        </>
      )}

      {/* Accordion sections */}
      {structured && (
        <div style={{ borderTop: '1px solid var(--border)' }}>
          <AccordionSection
            number="01"
            label="Timeline"
            preview={`${synthesis.timeline.length} event${synthesis.timeline.length !== 1 ? 's' : ''}`}
            isOpen={open.has('timeline')}
            onToggle={() => toggle('timeline')}
          >
            <Timeline items={synthesis.timeline} sources={sources} />
          </AccordionSection>

          <AccordionSection
            number="02"
            label="Points of Agreement"
            preview={`${synthesis.agreements.length} shared fact${synthesis.agreements.length !== 1 ? 's' : ''}`}
            isOpen={open.has('agreements')}
            onToggle={() => toggle('agreements')}
          >
            <Agreements items={synthesis.agreements} sources={sources} />
          </AccordionSection>

          <AccordionSection
            number="03"
            label="Points of Disagreement"
            preview={`${synthesis.factual_disagreements.length} dispute${synthesis.factual_disagreements.length !== 1 ? 's' : ''}`}
            isOpen={open.has('disagreements')}
            onToggle={() => toggle('disagreements')}
          >
            <FactualDisagreements items={synthesis.factual_disagreements} sources={sources} />
          </AccordionSection>

          <AccordionSection
            number="04"
            label="Framing Differences"
            preview={`${synthesis.framing_and_labeling.length} subject${synthesis.framing_and_labeling.length !== 1 ? 's' : ''}`}
            isOpen={open.has('framing')}
            onToggle={() => toggle('framing')}
          >
            <FramingAndLabelling items={synthesis.framing_and_labeling} sources={sources} />
          </AccordionSection>

          <AccordionSection
            number="05"
            label="Key Entities"
            preview={`${synthesis.key_entities.length} entit${synthesis.key_entities.length !== 1 ? 'ies' : 'y'}`}
            isOpen={open.has('entities')}
            onToggle={() => toggle('entities')}
          >
            <KeyEntities items={synthesis.key_entities} sources={sources} />
          </AccordionSection>

          <AccordionSection
            number="06"
            label="Open Questions"
            preview={`${synthesis.open_questions.length} question${synthesis.open_questions.length !== 1 ? 's' : ''}`}
            isOpen={open.has('questions')}
            onToggle={() => toggle('questions')}
          >
            <OpenQuestions questions={synthesis.open_questions} />
          </AccordionSection>
        </div>
      )}

      {/* Source list */}
      <SourceList sources={sources} extractedSourceIds={extractedSourceIds} />

      {/* Footer meta */}
      <div
        className="mt-4 font-ui flex flex-wrap gap-3"
        style={{ borderTop: '1px solid var(--border)', paddingTop: '8px' }}
      >
        <span style={{ fontSize: '9px', color: 'var(--ink-3)' }}>
          {sourcesUsed} of {sourcesAttempted} sources
        </span>
        <span style={{ fontSize: '9px', color: 'var(--ink-3)' }}>
          {(totalDurationMs / 1000).toFixed(1)}s
        </span>
        <span style={{ fontSize: '9px', color: 'var(--ink-3)' }}>
          {status}
        </span>
      </div>
    </div>
  );
}
