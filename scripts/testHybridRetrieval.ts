import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

type RetrievedChunk = {
  id?: string;
  title?: string;
  dataset?: string;
  sourceType?: string;
  source_type?: string;
  section?: string | null;
  chunkText?: string;
  chunk_text?: string;
  excerpt?: string;
  score?: number;
  finalScore?: number;
  vectorScore?: number;
  vectorSimilarity?: number;
  keywordScore?: number;
  metadataScore?: number;
  sectionScore?: number;
  retrievalReason?: string;
  metadata?: unknown;
};

type HybridRetrieverFunction = (
  input:
    | string
    | {
        question: string;
        sourceType?: string;
        sourceTypes?: string[];
        limit?: number;
        topK?: number;
        minScore?: number;
        preferredSections?: string[];
        filters?: Record<string, unknown>;
      }
) => Promise<unknown>;

function normalizeChunk(value: unknown): RetrievedChunk {
  if (!value || typeof value !== "object") {
    return {};
  }

  return value as RetrievedChunk;
}

function getText(chunk: RetrievedChunk) {
  return (
    chunk.excerpt ||
    chunk.chunkText ||
    chunk.chunk_text ||
    ""
  )
    .replace(/\s+/g, " ")
    .trim();
}

function getScore(chunk: RetrievedChunk) {
  return (
    chunk.finalScore ??
    chunk.score ??
    chunk.vectorScore ??
    chunk.vectorSimilarity ??
    0
  );
}

function extractChunks(result: unknown): RetrievedChunk[] {
  if (Array.isArray(result)) {
    return result.map(normalizeChunk);
  }

  if (!result || typeof result !== "object") {
    return [];
  }

  const record = result as Record<string, unknown>;

  const candidateKeys = [
    "chunks",
    "results",
    "sources",
    "documents",
    "matches",
    "retrievedChunks",
  ];

  for (const key of candidateKeys) {
    const value = record[key];

    if (Array.isArray(value)) {
      return value.map(normalizeChunk);
    }
  }

  return [];
}

function getRetrieverFunction(module: Record<string, unknown>) {
  const candidateNames = [
    "retrieveHybridContext",
    "retrieveHybridChunks",
    "hybridRetrieve",
    "retrieveRelevantChunks",
    "retrieveRelevantDocumentChunks",
    "retrieveDocumentChunks",
  ];

  for (const name of candidateNames) {
    const candidate = module[name];

    if (typeof candidate === "function") {
      return {
        name,
        fn: candidate as HybridRetrieverFunction,
      };
    }
  }

  throw new Error(
    `No known hybrid retriever export found. Available exports: ${Object.keys(
      module
    ).join(", ")}`
  );
}

async function runRetriever({
  fn,
  question,
}: {
  fn: HybridRetrieverFunction;
  question: string;
}) {
  try {
    return await fn({
      question,
      sourceType: "drug_label",
      sourceTypes: ["drug_label"],
      limit: 8,
      topK: 8,
      minScore: 0,
      preferredSections: [
        "Indications and Usage",
        "Purpose",
        "Warnings and Precautions",
        "Warnings",
        "Adverse Reactions",
        "Dosage and Administration",
        "Description",
      ],
    });
  } catch (objectCallError) {
    console.log("");
    console.log("Object-style retriever call failed. Trying string-style call...");
    console.log(
      objectCallError instanceof Error
        ? objectCallError.message
        : objectCallError
    );

    return fn(question);
  }
}

async function main() {
  const question =
    process.argv.slice(2).join(" ").trim() ||
    "What is Anoro Ellipta used for?";

  console.log("Starting hybrid retrieval test...");
  console.log({
    DATABASE_URL_LOADED: Boolean(process.env.DATABASE_URL),
    ENABLE_VECTOR_RETRIEVAL: process.env.ENABLE_VECTOR_RETRIEVAL,
    EMBEDDING_PROVIDER: process.env.EMBEDDING_PROVIDER,
    LOCAL_EMBEDDING_MODEL: process.env.LOCAL_EMBEDDING_MODEL,
    GEMINI_EMBEDDING_MODEL: process.env.GEMINI_EMBEDDING_MODEL,
  });

  if (!process.env.DATABASE_URL) {
    throw new Error(
      "DATABASE_URL is missing after loading .env.local. Make sure .env.local is in the project root and contains DATABASE_URL."
    );
  }

  const retrieverModule = (await import("../lib/rag/hybridRetriever")) as Record<
    string,
    unknown
  >;

  const { name, fn } = getRetrieverFunction(retrieverModule);

  console.log("");
  console.log("Question:");
  console.log(question);

  console.log("");
  console.log("Retriever export:");
  console.log(name);

  const result = await runRetriever({ fn, question });
  const chunks = extractChunks(result);

  console.log("");
  console.log("Raw result keys:");
  console.log(
    result && typeof result === "object" && !Array.isArray(result)
      ? Object.keys(result as Record<string, unknown>)
      : Array.isArray(result)
        ? ["array_result"]
        : typeof result
  );

  console.log("");
  console.log(`Retrieved chunks: ${chunks.length}`);

  for (const [index, chunk] of chunks.entries()) {
    console.log("");
    console.log(`Result ${index + 1}`);
    console.log({
      id: chunk.id,
      title: chunk.title,
      dataset: chunk.dataset,
      sourceType: chunk.sourceType || chunk.source_type,
      section: chunk.section,
      score: getScore(chunk),
      finalScore: chunk.finalScore,
      vectorScore: chunk.vectorScore,
      vectorSimilarity: chunk.vectorSimilarity,
      keywordScore: chunk.keywordScore,
      metadataScore: chunk.metadataScore,
      sectionScore: chunk.sectionScore,
      retrievalReason: chunk.retrievalReason,
    });

    console.log("Excerpt:");
    console.log(getText(chunk).slice(0, 700));
  }

  if (chunks.length === 0) {
    console.log("");
    console.log("No chunks returned. Check:");
    console.log("1. document_chunks has source_type = 'drug_label'");
    console.log("2. embeddings exist for Xenova/bge-base-en-v1.5");
    console.log("3. ENABLE_VECTOR_RETRIEVAL=true");
    console.log("4. hybridRetriever supports the sourceType/sourceTypes arguments");
  }
}

main().catch((error) => {
  console.error("Hybrid retrieval test failed:", error);
  process.exit(1);
});