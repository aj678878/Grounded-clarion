#!/usr/bin/env tsx
/* ------------------------------------------------------------------ */
/*  generate_dataset.ts — Synthetic eval dataset from Guardian + LLM  */
/*                                                                    */
/*  Fetches 5 recent articles, uses Claude to generate exactly 4      */
/*  evaluation questions per article (1 LLM call each) with           */
/*  expected_should_search labels. Writes 20-case JSONL.              */
/*                                                                    */
/*  Idempotent: will NOT overwrite existing dataset.jsonl              */
/*  unless --force flag is passed.                                    */
/* ------------------------------------------------------------------ */

import { config } from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

// Load .env.local BEFORE LLM imports
config({ path: path.resolve(process.cwd(), '.env.local') });

import {
  callAnthropic,
  withRetry,
  safeParseJson,
} from '../../src/lib/llm/index';
import { MODELS } from '../../src/lib/config';

/* ---------- Config ---------- */

const GUARDIAN_API_KEY = process.env.GUARDIAN_API_KEY;
const GUARDIAN_BASE = process.env.GUARDIAN_API_BASE_URL || 'https://content.guardianapis.com';
const MODEL = MODELS.judge;

const TARGET_ARTICLES = 5;
const QUESTIONS_PER_ARTICLE = 4;
const MAX_ARTICLE_TEXT_CHARS = 10_000;
const OUTPUT_PATH = path.resolve(process.cwd(), 'scripts/eval/dataset.jsonl');

/* ---------- Types ---------- */

interface RawArticle {
  id: string;
  title: string;
  bodyHtml: string;
  section: string;
}

interface GeneratedQuestion {
  question: string;
  type: string;
  expected_should_search: string; // "yes" | "no"
}

interface DatasetCase {
  case_id: string;
  article_id: string;
  article_title: string;
  article_text: string;
  question: string;
  expected_should_search: string;
}

/* ---------- Utilities ---------- */

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/h[1-6]>/gi, '\n\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

function truncateText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars) + '\n…[article truncated]';
}

/* ---------- CLI flags ---------- */

const forceOverwrite = process.argv.includes('--force');

/* ---------- Guardian fetch ---------- */

async function fetchRecentArticles(): Promise<RawArticle[]> {
  if (!GUARDIAN_API_KEY) throw new Error('GUARDIAN_API_KEY not set');

  const sections = ['business', 'world', 'technology'];
  const articles: RawArticle[] = [];
  const perSection = Math.ceil((TARGET_ARTICLES + 2) / sections.length);

  for (const section of sections) {
    const url =
      `${GUARDIAN_BASE}/${section}?page=1&page-size=${perSection}` +
      `&order-by=newest&show-fields=body,trailText&api-key=${GUARDIAN_API_KEY}`;

    try {
      const res = await fetch(url);
      if (!res.ok) {
        console.warn(`[guardian] ${section} returned ${res.status}`);
        continue;
      }
      const data = await res.json();
      const results = data.response?.results ?? [];

      for (const r of results) {
        if (!r.fields?.body) continue;
        articles.push({
          id: r.id,
          title: r.webTitle,
          bodyHtml: r.fields.body,
          section: r.sectionName ?? section,
        });
      }
    } catch (err) {
      console.warn(`[guardian] Error fetching ${section}:`, err);
    }
  }

  console.log(`[guardian] Fetched ${articles.length} articles with body text`);
  return articles.slice(0, TARGET_ARTICLES + 2);
}

/* ---------- Question generation via Claude ---------- */

async function generateQuestions(
  article: { id: string; title: string; text: string }
): Promise<GeneratedQuestion[]> {
  const promptText = truncateText(article.text, 3_000);

  const prompt = `Given the following news article, generate exactly ${QUESTIONS_PER_ARTICLE} realistic questions that a curious reader might ask a news tutoring AI.

Requirements:
- Mix question types:
  - 2 definition/background questions (e.g., "What is [concept]?", "Who is [person]?", "Explain [policy/term]")
  - 1 implications question (e.g., "What does this mean for [stakeholder]?", "What are the potential consequences?")
  - 1 clarification question (e.g., "Can you explain [specific claim]?", "What does [phrase] mean in this context?")

- For each question, set expected_should_search to "yes" or "no":
  - "yes": if the answer requires background, definitions, history, agenda, or current status NOT explicitly present in the article
  - "no": if the article text alone contains enough information to answer

- Questions should be natural and conversational, as a real user would ask them.

Article Title: ${article.title}

Article Text:
${promptText}

Output strict JSON array of exactly ${QUESTIONS_PER_ARTICLE} objects:
[
  {"question": "...", "type": "definition|implication|clarification", "expected_should_search": "yes"|"no"},
  ...
]`;

  const raw = await withRetry(
    () =>
      callAnthropic({
        model: MODEL,
        system: 'You MUST respond with ONLY valid JSON. No markdown, no prose, no code fences.',
        messages: [{ role: 'user', content: prompt }],
        maxTokens: 1000,
      }),
    { label: `questions for "${article.title.slice(0, 40)}"` }
  );

  const parsed = safeParseJson(raw);
  if (!parsed.ok || !parsed.data) {
    console.warn(`[llm] Failed to parse questions for "${article.title}":`, raw.slice(0, 200));
    return [];
  }

  // The data might be an array wrapped in an object or a direct array
  const arr = Array.isArray(parsed.data) ? parsed.data : (parsed.data as Record<string, unknown>);
  if (!Array.isArray(arr)) {
    console.warn(`[llm] Expected array for "${article.title}"`);
    return [];
  }

  return (arr as GeneratedQuestion[]).filter(
    (q) =>
      typeof q.question === 'string' &&
      (q.expected_should_search === 'yes' || q.expected_should_search === 'no')
  );
}

/* ---------- Main ---------- */

async function main() {
  if (fs.existsSync(OUTPUT_PATH) && fs.statSync(OUTPUT_PATH).size > 10) {
    if (!forceOverwrite) {
      console.log(`dataset.jsonl already exists (${fs.statSync(OUTPUT_PATH).size} bytes).`);
      console.log('Use --force to regenerate.');
      process.exit(0);
    }
    console.log('[force] Overwriting existing dataset.jsonl\n');
  }

  console.log('=== Generating eval dataset ===\n');

  const rawArticles = await fetchRecentArticles();
  if (rawArticles.length === 0) {
    console.error('No articles fetched. Check GUARDIAN_API_KEY.');
    process.exit(1);
  }

  const dataset: DatasetCase[] = [];
  let caseIndex = 0;
  let articlesUsed = 0;

  for (let i = 0; i < rawArticles.length && articlesUsed < TARGET_ARTICLES; i++) {
    const article = rawArticles[i];
    const fullText = stripHtml(article.bodyHtml);

    if (fullText.length < 200) {
      console.warn(`[skip] Article too short: "${article.title}" (${fullText.length} chars)`);
      continue;
    }

    const articleText = truncateText(fullText, MAX_ARTICLE_TEXT_CHARS);

    console.log(`[${articlesUsed + 1}/${TARGET_ARTICLES}] Generating questions for: "${article.title}"`);

    try {
      const questions = await generateQuestions({
        id: article.id,
        title: article.title,
        text: fullText,
      });

      const toUse = questions.slice(0, QUESTIONS_PER_ARTICLE);

      for (const q of toUse) {
        dataset.push({
          case_id: `case-${String(caseIndex).padStart(3, '0')}`,
          article_id: article.id,
          article_title: article.title,
          article_text: articleText,
          question: q.question,
          expected_should_search: q.expected_should_search,
        });
        caseIndex++;
      }

      articlesUsed++;
      console.log(`  → ${toUse.length} questions generated`);
    } catch (err) {
      console.warn(`  → Error generating questions:`, err);
    }
  }

  const lines = dataset.map((d) => JSON.stringify(d)).join('\n');
  fs.writeFileSync(OUTPUT_PATH, lines + '\n');

  console.log(`\nWrote ${dataset.length} cases to scripts/eval/dataset.jsonl`);
  console.log(`  Articles used: ${articlesUsed}`);
  console.log(
    `  Expected search: ${dataset.filter((d) => d.expected_should_search === 'yes').length} yes, ` +
      `${dataset.filter((d) => d.expected_should_search === 'no').length} no`
  );
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
