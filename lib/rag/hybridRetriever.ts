import type { SourceEvidence } from "../../types/evidence";
import { sql } from "../db/client";
import {
  embedText,
  getTargetEmbeddingModel,
  toPgVector,
} from "./embeddingClient";

export type RetrieveHybridChunksInput = {
  question: string;
  topK?: number;
  limit?: number;
  sourceType?: string;
  sourceTypes?: string[];
  sections?: string[];
  drugName?: string;
  includeVector?: boolean;
  includeKeyword?: boolean;
};

export type HybridRetrievedChunk = {
  id: string;
  documentId: string;
  chunkText: string;
  section: string;
  chunkIndex: number | null;
  sourceType: string;
  title: string;
  sourceUrl: string;
  sourceDataset: string;
  drugName: string;
  genericName: string;
  manufacturerName: string;
  vectorScore: number;
  keywordScore: number;
  combinedScore: number;
  vectorSimilarity: number | null;
  retrievalReason: string;
  metadata: Record<string, unknown>;
  documentMetadata: Record<string, unknown>;
};

export type HybridRetrievalResult = {
  question: string;
  retrievalMode: "vector" | "keyword" | "hybrid" | "none";
  retriever: "hybridRetriever";
  targetEmbeddingModel: string;
  topK: number;
  sourceTypes: string[];
  sections: string[];
  terms: string[];
  chunks: HybridRetrievedChunk[];
  sources: SourceEvidence[];
  rows: HybridRetrievedChunk[];
  debug: {
    vectorEnabled: boolean;
    keywordEnabled: boolean;
    vectorError: string | null;
    keywordError: string | null;
    vectorCandidateCount: number;
    keywordCandidateCount: number;
  };
};

type DbChunkRow = {
  id: string;
  document_id: string | null;
  chunk_text: string | null;
  section: string | null;
  chunk_index: number | null;
  source_type: string | null;
  metadata: Record<string, unknown> | null;
  title: string | null;
  source_url: string | null;
  source_dataset: string | null;
  document_metadata: Record<string, unknown> | null;
  drug_name: string | null;
  generic_name: string | null;
  manufacturer_name: string | null;
  vector_similarity?: number | string | null;
};

function normalizeText(value: unknown) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanText(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function resolveRetrieverQuestion(input: unknown) {
  if (typeof input === "string") {
    return input.trim();
  }

  if (input && typeof input === "object" && !Array.isArray(input)) {
    const record = input as Record<string, unknown>;

    const possibleQuestion =
      record.question ??
      record.query ??
      record.userQuestion ??
      record.input ??
      "";

    return String(possibleQuestion ?? "").trim();
  }

  return "";
}

function resolveOptions(input: unknown) {
  if (input && typeof input === "object" && !Array.isArray(input)) {
    return input as Record<string, unknown>;
  }

  return {};
}

function toBoolean(value: unknown, fallback: boolean) {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    if (value.toLowerCase() === "true") return true;
    if (value.toLowerCase() === "false") return false;
  }

  return fallback;
}

function toStringArray(value: unknown) {
  if (Array.isArray(value)) {
    return value
      .map((item) => cleanText(item))
      .filter(Boolean);
  }

  if (typeof value === "string" && value.trim()) {
    return [value.trim()];
  }

  return [];
}

function getQuestionTerms(question: unknown) {
  const normalized = normalizeText(question);

  if (!normalized) {
    return [];
  }

  const stopWords = new Set([
    "what",
    "which",
    "who",
    "when",
    "where",
    "why",
    "how",
    "is",
    "are",
    "was",
    "were",
    "the",
    "a",
    "an",
    "for",
    "of",
    "to",
    "in",
    "on",
    "with",
    "and",
    "or",
    "used",
    "use",
    "uses",
    "does",
    "do",
    "label",
    "fda",
    "drug",
    "show",
    "tell",
    "about",
    "summarize",
    "mention",
    "mentions",
    "listed",
    "available",
    "loaded",
    "public",
    "data",
    "evidence",
    "context",
    "keep",
    "concise",
    "citations",
    "include",
  ]);

  return normalized
    .split(" ")
    .map((term) => term.trim())
    .filter((term) => term.length >= 3)
    .filter((term) => !stopWords.has(term))
    .slice(0, 16);
}

function getPreferredSections(question: string) {
  const normalized = normalizeText(question);

  if (
    normalized.includes("used for") ||
    normalized.includes("indication") ||
    normalized.includes("indications")
  ) {
    return ["Indications and Usage", "Purpose"];
  }

  if (
    normalized.includes("warning") ||
    normalized.includes("precaution") ||
    normalized.includes("boxed")
  ) {
    return ["Boxed Warning", "Warnings and Precautions", "Warnings"];
  }

  if (
    normalized.includes("adverse") ||
    normalized.includes("reaction") ||
    normalized.includes("side effect")
  ) {
    return ["Adverse Reactions"];
  }

  if (
    normalized.includes("dose") ||
    normalized.includes("dosage") ||
    normalized.includes("administration")
  ) {
    return ["Dosage and Administration"];
  }

  if (normalized.includes("contraindication")) {
    return ["Contraindications"];
  }

  return [];
}

function asNumber(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function safeMetadata(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return {};
}

function excerpt(value: string, maxLength = 900) {
  const cleaned = cleanText(value);

  if (cleaned.length <= maxLength) {
    return cleaned;
  }

  return `${cleaned.slice(0, maxLength).trim()}...`;
}

function includesAnyTerm(text: string, terms: string[]) {
  const normalized = normalizeText(text);
  return terms.some((term) => normalized.includes(normalizeText(term)));
}

function keywordScoreForRow(
  row: DbChunkRow,
  terms: string[],
  preferredSections: string[]
) {
  const chunkText = normalizeText(row.chunk_text);
  const title = normalizeText(row.title);
  const section = cleanText(row.section);
  const normalizedSection = normalizeText(row.section);
  const drugName = normalizeText(row.drug_name);
  const brandName = normalizeText(
    (row.metadata as Record<string, unknown> | null)?.brandName ?? row.drug_name
  );
  const genericName = normalizeText(row.generic_name);
  const manufacturerName = normalizeText(row.manufacturer_name);

  const searchableText = [
    chunkText,
    title,
    normalizedSection,
    drugName,
    brandName,
    genericName,
    manufacturerName,
  ].join(" ");

  let score = 0;

  const uniqueTerms = Array.from(
    new Set(terms.map((term) => normalizeText(term)).filter(Boolean))
  );

  const matchedTerms = uniqueTerms.filter((term) => searchableText.includes(term));
  const matchedDrugTerms = uniqueTerms.filter(
    (term) => drugName.includes(term) || brandName.includes(term)
  );

  const exactDrugPhrase = uniqueTerms.length >= 2 && drugName.includes(uniqueTerms.join(" "));
  const exactBrandPhrase = uniqueTerms.length >= 2 && brandName.includes(uniqueTerms.join(" "));

  if (matchedTerms.length > 0) {
    score += Math.min(0.3, matchedTerms.length * 0.1);
  }

  if (matchedDrugTerms.length > 0) {
    score += Math.min(0.35, matchedDrugTerms.length * 0.18);
  }

  if (exactDrugPhrase || exactBrandPhrase) {
    score += 0.2;
  }

  if (preferredSections.length > 0 && preferredSections.includes(section)) {
    score += 0.25;
  }

  if (
    preferredSections.length > 0 &&
    preferredSections.some((preferredSection) =>
      normalizedSection.includes(normalizeText(preferredSection))
    )
  ) {
    score += 0.12;
  }

  const questionLooksLikeUseCase =
    preferredSections.includes("Indications and Usage") ||
    preferredSections.includes("Purpose");

  if (
    questionLooksLikeUseCase &&
    (chunkText.includes("indicated") ||
      chunkText.includes("used for") ||
      chunkText.includes("treatment") ||
      chunkText.includes("maintenance treatment") ||
      chunkText.includes("purpose"))
  ) {
    score += 0.18;
  }

  if (chunkText.includes("not indicated") || chunkText.includes("not for")) {
    score += 0.05;
  }

  return Math.min(Number(score.toFixed(4)), 1);
}

function toChunk({
  row,
  terms,
  preferredSections,
  vectorWeight,
  keywordWeight,
  source,
}: {
  row: DbChunkRow;
  terms: string[];
  preferredSections: string[];
  vectorWeight: number;
  keywordWeight: number;
  source: "vector" | "keyword";
}): HybridRetrievedChunk {
  const vectorSimilarity =
    row.vector_similarity === null || row.vector_similarity === undefined
      ? null
      : asNumber(row.vector_similarity, 0);

  const vectorScore = vectorSimilarity === null ? 0 : Math.max(0, vectorSimilarity);
  const keywordScore = keywordScoreForRow(row, terms, preferredSections);

  const combinedScore =
    source === "vector"
      ? vectorScore * vectorWeight + keywordScore * keywordWeight
      : keywordScore * keywordWeight;

  const metadata = safeMetadata(row.metadata);
  const documentMetadata = safeMetadata(row.document_metadata);

  const reasons = [];

  if (vectorSimilarity !== null) {
    reasons.push(`vector similarity ${vectorSimilarity.toFixed(4)}`);
  }

  if (keywordScore > 0) {
    reasons.push(`keyword score ${keywordScore.toFixed(4)}`);
  }

  if (row.section && preferredSections.includes(row.section)) {
    reasons.push(`preferred section ${row.section}`);
  }

  return {
    id: cleanText(row.id),
    documentId: cleanText(row.document_id),
    chunkText: cleanText(row.chunk_text),
    section: cleanText(row.section),
    chunkIndex: row.chunk_index,
    sourceType: cleanText(row.source_type || "drug_label"),
    title: cleanText(row.title || "openFDA label"),
    sourceUrl: cleanText(row.source_url),
    sourceDataset: cleanText(row.source_dataset || "openFDA Drug Label Dataset"),
    drugName: cleanText(row.drug_name),
    genericName: cleanText(row.generic_name),
    manufacturerName: cleanText(row.manufacturer_name),
    vectorScore,
    keywordScore,
    combinedScore,
    vectorSimilarity,
    retrievalReason: reasons.length > 0 ? reasons.join("; ") : source,
    metadata,
    documentMetadata,
  };
}

function buildSourceEvidence(chunks: HybridRetrievedChunk[]): SourceEvidence[] {
  return chunks.map((chunk, index) => {
    const citationNumber = index + 1;

    const metadata = [
      `Citation: [KB-${citationNumber}]`,
      `Source type: ${chunk.sourceType}`,
      `Section: ${chunk.section || "Unknown"}`,
      `Drug: ${chunk.drugName || "Unknown"}`,
      `Generic: ${chunk.genericName || "Unknown"}`,
      `Manufacturer: ${chunk.manufacturerName || "Unknown"}`,
      `Retrieval: ${chunk.retrievalReason}`,
    ].filter(Boolean);

    if (chunk.sourceUrl) {
      metadata.push(`URL: ${chunk.sourceUrl}`);
    }

    return {
      id: chunk.id,
      title: chunk.title,
      dataset: chunk.sourceDataset,
      score: Number(chunk.combinedScore.toFixed(4)),
      status: "used",
      excerpt: excerpt(chunk.chunkText),
      metadata,
      citationLabel: `KB-${citationNumber}`,
      citationType: "kb",
    };
  });
}

function mergeChunks(chunks: HybridRetrievedChunk[], topK: number) {
  const byId = new Map<string, HybridRetrievedChunk>();

  for (const chunk of chunks) {
    const existing = byId.get(chunk.id);

    if (!existing || chunk.combinedScore > existing.combinedScore) {
      byId.set(chunk.id, chunk);
    }
  }

  return Array.from(byId.values())
    .sort((a, b) => b.combinedScore - a.combinedScore)
    .slice(0, topK);
}

function resolveSourceTypes(options: Record<string, unknown>) {
  const sourceTypes = [
    ...toStringArray(options.sourceTypes),
    ...toStringArray(options.sourceType),
  ];

  if (sourceTypes.length > 0) {
    return Array.from(new Set(sourceTypes));
  }

  return ["drug_label"];
}

function resolveSections({
  question,
  options,
}: {
  question: string;
  options: Record<string, unknown>;
}) {
  const explicitSections = toStringArray(options.sections);

  if (explicitSections.length > 0) {
    return explicitSections;
  }

  return getPreferredSections(question);
}

function getDrugFilter(options: Record<string, unknown>) {
  return cleanText(options.drugName ?? options.drug ?? options.brandName ?? "");
}

async function retrieveVectorRows({
  question,
  topK,
  sourceTypes,
  targetEmbeddingModel,
}: {
  question: string;
  topK: number;
  sourceTypes: string[];
  targetEmbeddingModel: string;
}) {
  const queryEmbedding = await embedText(question, { inputType: "query" });
  const queryVector = toPgVector(queryEmbedding);

  const rows = await sql<DbChunkRow[]>`
    select
      dc.id::text as id,
      dc.document_id::text as document_id,
      dc.chunk_text,
      dc.section,
      dc.chunk_index,
      dc.source_type,
      dc.metadata,
      d.title,
      d.source_url,
      d.source_dataset,
      d.metadata as document_metadata,
      coalesce(
        dc.metadata->>'drugName',
        dc.metadata->>'brandName',
        d.metadata->>'drugName',
        d.metadata->>'brandName',
        ''
      ) as drug_name,
      coalesce(
        dc.metadata->>'genericName',
        d.metadata->>'genericName',
        ''
      ) as generic_name,
      coalesce(
        dc.metadata->>'manufacturerName',
        d.metadata->>'manufacturerName',
        ''
      ) as manufacturer_name,
      (1 - (dc.embedding <=> ${queryVector}::vector)) as vector_similarity
    from document_chunks dc
    left join documents d on d.id = dc.document_id
    where dc.source_type = any(${sourceTypes})
      and dc.embedding is not null
      and dc.embedding_model = ${targetEmbeddingModel}
    order by dc.embedding <=> ${queryVector}::vector
    limit ${Math.max(topK * 3, 20)}
  `;

  return rows;
}

async function retrieveKeywordRows({
  question,
  terms,
  topK,
  sourceTypes,
  sections,
  drugFilter,
}: {
  question: string;
  terms: string[];
  topK: number;
  sourceTypes: string[];
  sections: string[];
  drugFilter: string;
}) {
  const usableTerms = terms.length > 0 ? terms : getQuestionTerms(question);
  const patterns = usableTerms.map((term) => `%${term}%`);
  const sectionPatterns = sections.map((section) => `%${section}%`);
  const drugPattern = drugFilter ? `%${drugFilter}%` : "";

  const rows = await sql<DbChunkRow[]>`
    select
      dc.id::text as id,
      dc.document_id::text as document_id,
      dc.chunk_text,
      dc.section,
      dc.chunk_index,
      dc.source_type,
      dc.metadata,
      d.title,
      d.source_url,
      d.source_dataset,
      d.metadata as document_metadata,
      coalesce(
        dc.metadata->>'drugName',
        dc.metadata->>'brandName',
        d.metadata->>'drugName',
        d.metadata->>'brandName',
        ''
      ) as drug_name,
      coalesce(
        dc.metadata->>'genericName',
        d.metadata->>'genericName',
        ''
      ) as generic_name,
      coalesce(
        dc.metadata->>'manufacturerName',
        d.metadata->>'manufacturerName',
        ''
      ) as manufacturer_name,
      null::float as vector_similarity
    from document_chunks dc
    left join documents d on d.id = dc.document_id
    where dc.source_type = any(${sourceTypes})
      and (
        ${patterns.length === 0}
        or dc.chunk_text ilike any(${patterns})
        or d.title ilike any(${patterns})
        or coalesce(dc.metadata->>'drugName', dc.metadata->>'brandName', d.metadata->>'drugName', d.metadata->>'brandName', '') ilike any(${patterns})
        or coalesce(dc.metadata->>'genericName', d.metadata->>'genericName', '') ilike any(${patterns})
      )
      and (
        ${sectionPatterns.length === 0}
        or dc.section ilike any(${sectionPatterns})
      )
      and (
        ${drugPattern === ""}
        or coalesce(dc.metadata->>'drugName', dc.metadata->>'brandName', d.metadata->>'drugName', d.metadata->>'brandName', '') ilike ${drugPattern}
        or coalesce(dc.metadata->>'genericName', d.metadata->>'genericName', '') ilike ${drugPattern}
      )
    order by
      case
        when dc.section = any(${sections}) then 0
        else 1
      end,
      dc.chunk_index nulls last,
      dc.created_at asc
    limit ${Math.max(topK * 4, 30)}
  `;

  return rows;
}

export async function retrieveHybridChunks(input: unknown): Promise<HybridRetrievalResult> {
  const question = resolveRetrieverQuestion(input);

  if (!question) {
    throw new Error("retrieveHybridChunks requires a non-empty question.");
  }

  const options = resolveOptions(input);

  const topK = Math.max(
    1,
    Math.min(Number(options.topK ?? options.limit ?? 8), 25)
  );

  const sourceTypes = resolveSourceTypes(options);
  const sections = resolveSections({ question, options });
  const drugFilter = getDrugFilter(options);
  const terms = getQuestionTerms(`${question} ${drugFilter}`);

  const vectorEnabled =
    process.env.ENABLE_VECTOR_RETRIEVAL === "true" &&
    toBoolean(options.includeVector, true);

  const keywordEnabled = toBoolean(options.includeKeyword, true);

  const targetEmbeddingModel = getTargetEmbeddingModel();

  const vectorWeight = 0.72;
  const keywordWeight = 0.28;

  let vectorRows: DbChunkRow[] = [];
  let keywordRows: DbChunkRow[] = [];

  let vectorError: string | null = null;
  let keywordError: string | null = null;

  if (vectorEnabled) {
    try {
      vectorRows = await retrieveVectorRows({
        question,
        topK,
        sourceTypes,
        targetEmbeddingModel,
      });
    } catch (error) {
      vectorError =
        error instanceof Error ? error.message : "Unknown vector retrieval error.";
    }
  }

  if (keywordEnabled) {
    try {
      keywordRows = await retrieveKeywordRows({
        question,
        terms,
        topK,
        sourceTypes,
        sections,
        drugFilter,
      });
    } catch (error) {
      keywordError =
        error instanceof Error ? error.message : "Unknown keyword retrieval error.";
    }
  }

  const vectorChunks = vectorRows.map((row) =>
    toChunk({
      row,
      terms,
      preferredSections: sections,
      vectorWeight,
      keywordWeight,
      source: "vector",
    })
  );

  const keywordChunks = keywordRows.map((row) =>
    toChunk({
      row,
      terms,
      preferredSections: sections,
      vectorWeight,
      keywordWeight,
      source: "keyword",
    })
  );

  const chunks = mergeChunks([...vectorChunks, ...keywordChunks], topK);

  const retrievalMode: HybridRetrievalResult["retrievalMode"] =
    vectorChunks.length > 0 && keywordChunks.length > 0
      ? "hybrid"
      : vectorChunks.length > 0
        ? "vector"
        : keywordChunks.length > 0
          ? "keyword"
          : "none";

  const sources = buildSourceEvidence(chunks);

  return {
    question,
    retrievalMode,
    retriever: "hybridRetriever",
    targetEmbeddingModel,
    topK,
    sourceTypes,
    sections,
    terms,
    chunks,
    sources,
    rows: chunks,
    debug: {
      vectorEnabled,
      keywordEnabled,
      vectorError,
      keywordError,
      vectorCandidateCount: vectorRows.length,
      keywordCandidateCount: keywordRows.length,
    },
  };
}

export async function retrieveRelevantChunks(input: unknown) {
  return retrieveHybridChunks(input);
}

export async function retrieveChunks(input: unknown) {
  return retrieveHybridChunks(input);
}

export default retrieveHybridChunks;