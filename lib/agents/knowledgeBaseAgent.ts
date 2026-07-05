import { sql } from "@/lib/db/client";
import type { SourceEvidence } from "@/types/evidence";

type KnowledgeBaseRow = {
  chunk_id: string;
  title: string | null;
  dataset_name: string | null;
  source_name: string | null;
  source_type: string | null;
  chunk_text: string;
};

const stopWords = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "for",
  "to",
  "of",
  "in",
  "on",
  "is",
  "are",
  "was",
  "were",
  "what",
  "which",
  "who",
  "how",
  "why",
  "can",
  "you",
  "me",
  "this",
  "that",
  "had",
  "has",
  "have",
  "biggest",
  "top",
]);

function extractSearchTerms(question: string) {
  const terms = question
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .map((term) => term.trim())
    .filter((term) => term.length >= 3)
    .filter((term) => !stopWords.has(term));

  return Array.from(new Set(terms)).slice(0, 10);
}

function countMatches(searchText: string, terms: string[]) {
  let matchCount = 0;

  for (const term of terms) {
    if (searchText.includes(term)) {
      matchCount += 1;
    }
  }

  return matchCount;
}

export async function retrieveKnowledgeBaseSources(question: string) {
  const terms = extractSearchTerms(question);

  if (terms.length === 0) {
    return [];
  }

  const rows = await sql<KnowledgeBaseRow[]>`
    select
      dc.id::text as chunk_id,
      d.title,
      d.dataset_name,
      d.source_name,
      dc.source_type,
      dc.chunk_text
    from document_chunks dc
    join documents d on d.id = dc.document_id
    order by dc.created_at desc
    limit 200
  `;

  const scoredRows = rows
    .map((row) => {
      const searchableText = [
        row.title,
        row.dataset_name,
        row.source_name,
        row.source_type,
        row.chunk_text,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return {
        row,
        matchCount: countMatches(searchableText, terms),
      };
    })
    .filter((item) => item.matchCount > 0)
    .sort((a, b) => b.matchCount - a.matchCount)
    .slice(0, 3);

  return scoredRows.map((item): SourceEvidence => {
    const score = Math.min(0.55 + item.matchCount * 0.1, 0.95);

    return {
      id: item.row.chunk_id,
      title: item.row.title ?? "Knowledge base chunk",
      dataset: item.row.dataset_name ?? "PharmaRev AI Knowledge Base",
      score,
      status: "used",
      excerpt: item.row.chunk_text,
      metadata: [
        `Source name: ${item.row.source_name ?? "Unknown"}`,
        `Source type: ${item.row.source_type ?? "Unknown"}`,
        `Keyword matches: ${item.matchCount}`,
        "Retrieval method: TypeScript keyword scoring over Neon document_chunks",
        "Embedding status: not embedded yet",
      ],
    };
  });
}