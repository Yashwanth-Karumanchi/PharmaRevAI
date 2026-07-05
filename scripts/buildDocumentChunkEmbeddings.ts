import dotenv from "dotenv";
import {
  EmbeddingRateLimitError,
  embedTextsBatch,
  getEmbeddingProvider,
  getTargetEmbeddingModel,
  hashEmbeddingText,
  normalizeEmbeddingText,
  toPgVector,
} from "../lib/rag/embeddingClient";

dotenv.config({ path: ".env.local" });

type ChunkRow = {
  id: string;
  chunk_text: string;
  title: string | null;
  embedding_source_text_hash: string | null;
  embedding_model: string | null;
};

type CountRow = {
  total_chunks: string;
  embedded_chunks: string;
  current_model_embeddings: string;
  target_missing_embeddings: string;
};

type PreparedChunk = {
  id: string;
  text: string;
  title: string | null;
  textHash: string;
};

const targetEmbeddingModel = getTargetEmbeddingModel();
const embeddingProvider = getEmbeddingProvider();
const batchSize = Number(process.env.EMBEDDING_BATCH_SIZE || 16);
const requestDelayMs = Number(process.env.EMBEDDING_REQUEST_DELAY_MS || 0);
const defaultRateLimitWaitMs = Number(
  process.env.EMBEDDING_RATE_LIMIT_WAIT_MS || 3600000
);
const sourceType = process.env.EMBEDDING_SOURCE_TYPE || "";
const refreshAll = process.env.EMBEDDING_REFRESH_ALL === "true";
const reembedDifferentModel =
  process.env.EMBEDDING_REEMBED_DIFFERENT_MODEL === "true";
const continueUntilDone = process.env.EMBEDDING_CONTINUE_UNTIL_DONE !== "false";
const maxRateLimitRetries = Number(
  process.env.EMBEDDING_MAX_RATE_LIMIT_RETRIES || 9999
);

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatWait(ms: number) {
  const totalSeconds = Math.ceil(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m ${seconds}s`;
  }

  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }

  return `${seconds}s`;
}

function getEmbeddingInputText(chunkText: string) {
  return normalizeEmbeddingText(chunkText).slice(0, 7000);
}

function prepareChunk(row: ChunkRow): PreparedChunk {
  const text = getEmbeddingInputText(row.chunk_text);

  return {
    id: row.id,
    text,
    title: row.title,
    textHash: hashEmbeddingText(text),
  };
}

function groupByHash(chunks: PreparedChunk[]) {
  const byHash = new Map<string, PreparedChunk[]>();

  for (const chunk of chunks) {
    const existing = byHash.get(chunk.textHash) ?? [];
    existing.push(chunk);
    byHash.set(chunk.textHash, existing);
  }

  return byHash;
}

async function getProgressCounts() {
  const { sql } = await import("../lib/db/client");

  if (sourceType) {
    const rows = await sql<CountRow[]>`
      select
        count(*)::text as total_chunks,
        count(*) filter (where embedding is not null)::text as embedded_chunks,
        count(*) filter (
          where embedding is not null
            and embedding_model = ${targetEmbeddingModel}
        )::text as current_model_embeddings,
        count(*) filter (
          where
            ${refreshAll}
            or embedding is null
            or embedding_source_text_hash is null
            or (
              ${reembedDifferentModel}
              and coalesce(embedding_model, '') <> ${targetEmbeddingModel}
            )
        )::text as target_missing_embeddings
      from document_chunks
      where source_type = ${sourceType}
    `;

    return {
      totalChunks: Number(rows[0]?.total_chunks ?? 0),
      embeddedChunks: Number(rows[0]?.embedded_chunks ?? 0),
      currentModelEmbeddings: Number(rows[0]?.current_model_embeddings ?? 0),
      targetMissingEmbeddings: Number(rows[0]?.target_missing_embeddings ?? 0),
    };
  }

  const rows = await sql<CountRow[]>`
    select
      count(*)::text as total_chunks,
      count(*) filter (where embedding is not null)::text as embedded_chunks,
      count(*) filter (
        where embedding is not null
          and embedding_model = ${targetEmbeddingModel}
      )::text as current_model_embeddings,
      count(*) filter (
        where
          ${refreshAll}
          or embedding is null
          or embedding_source_text_hash is null
          or (
            ${reembedDifferentModel}
            and coalesce(embedding_model, '') <> ${targetEmbeddingModel}
          )
      )::text as target_missing_embeddings
    from document_chunks
  `;

  return {
    totalChunks: Number(rows[0]?.total_chunks ?? 0),
    embeddedChunks: Number(rows[0]?.embedded_chunks ?? 0),
    currentModelEmbeddings: Number(rows[0]?.current_model_embeddings ?? 0),
    targetMissingEmbeddings: Number(rows[0]?.target_missing_embeddings ?? 0),
  };
}

async function getChunksToEmbed() {
  const { sql } = await import("../lib/db/client");

  if (sourceType) {
    return sql<ChunkRow[]>`
      select
        dc.id,
        dc.chunk_text,
        d.title,
        dc.embedding_source_text_hash,
        dc.embedding_model
      from document_chunks dc
      left join documents d on d.id = dc.document_id
      where dc.chunk_text is not null
        and dc.source_type = ${sourceType}
        and (
          ${refreshAll}
          or dc.embedding is null
          or dc.embedding_source_text_hash is null
          or (
            ${reembedDifferentModel}
            and coalesce(dc.embedding_model, '') <> ${targetEmbeddingModel}
          )
        )
      order by dc.created_at asc
      limit ${batchSize}
    `;
  }

  return sql<ChunkRow[]>`
    select
      dc.id,
      dc.chunk_text,
      d.title,
      dc.embedding_source_text_hash,
      dc.embedding_model
    from document_chunks dc
    left join documents d on d.id = dc.document_id
    where dc.chunk_text is not null
      and (
        ${refreshAll}
        or dc.embedding is null
        or dc.embedding_source_text_hash is null
        or (
          ${reembedDifferentModel}
          and coalesce(dc.embedding_model, '') <> ${targetEmbeddingModel}
        )
      )
    order by dc.created_at asc
    limit ${batchSize}
  `;
}

async function findExistingEmbeddedChunkId(textHash: string) {
  const { sql } = await import("../lib/db/client");

  const rows = await sql<{ id: string }[]>`
    select id
    from document_chunks
    where embedding_source_text_hash = ${textHash}
      and embedding_model = ${targetEmbeddingModel}
      and embedding is not null
    order by embedding_updated_at desc nulls last
    limit 1
  `;

  return rows[0]?.id ?? null;
}

async function copyExistingEmbedding({
  targetId,
  sourceId,
}: {
  targetId: string;
  sourceId: string;
}) {
  const { sql } = await import("../lib/db/client");

  await sql`
    update document_chunks target
    set
      embedding = source.embedding,
      embedding_model = source.embedding_model,
      embedding_source_text_hash = source.embedding_source_text_hash,
      embedding_updated_at = now()
    from document_chunks source
    where target.id = ${targetId}
      and source.id = ${sourceId}
  `;
}

async function updateChunkEmbedding({
  id,
  embedding,
  textHash,
}: {
  id: string;
  embedding: number[];
  textHash: string;
}) {
  const { sql } = await import("../lib/db/client");

  await sql`
    update document_chunks
    set
      embedding = ${toPgVector(embedding)}::vector,
      embedding_model = ${targetEmbeddingModel},
      embedding_source_text_hash = ${textHash},
      embedding_updated_at = now()
    where id = ${id}
  `;
}

async function copyReusableEmbeddings(chunks: PreparedChunk[]) {
  const reusable: PreparedChunk[] = [];
  const stillNeedEmbedding: PreparedChunk[] = [];

  for (const chunk of chunks) {
    const existingId = await findExistingEmbeddedChunkId(chunk.textHash);

    if (existingId && existingId !== chunk.id) {
      await copyExistingEmbedding({
        targetId: chunk.id,
        sourceId: existingId,
      });

      reusable.push(chunk);
    } else {
      stillNeedEmbedding.push(chunk);
    }
  }

  return {
    reused: reusable,
    stillNeedEmbedding,
  };
}

async function embedPreparedChunks(chunks: PreparedChunk[]) {
  const grouped = groupByHash(chunks);
  const uniqueChunks = Array.from(grouped.values()).map((group) => group[0]);

  if (uniqueChunks.length === 0) {
    return {
      embeddedRows: 0,
      embeddedUniqueTexts: 0,
    };
  }

  const results = await embedTextsBatch(
    uniqueChunks.map((chunk) => ({
      text: chunk.text,
      title: chunk.title,
      inputType: "document",
    }))
  );

  let embeddedRows = 0;

  for (const [index, result] of results.entries()) {
    const uniqueChunk = uniqueChunks[index];
    const duplicates = grouped.get(uniqueChunk.textHash) ?? [];

    for (const duplicate of duplicates) {
      await updateChunkEmbedding({
        id: duplicate.id,
        embedding: result.embedding,
        textHash: uniqueChunk.textHash,
      });

      embeddedRows += 1;
    }
  }

  return {
    embeddedRows,
    embeddedUniqueTexts: uniqueChunks.length,
  };
}

async function main() {
  console.log("Starting optimized document chunk embedding build...");
  console.log({
    embeddingProvider,
    targetEmbeddingModel,
    batchSize,
    requestDelayMs,
    defaultRateLimitWaitMs,
    sourceType: sourceType || "all",
    refreshAll,
    reembedDifferentModel,
    continueUntilDone,
    maxRateLimitRetries,
  });

  if (embeddingProvider === "local_bge") {
    console.log("");
    console.log("Using local BGE embeddings.");
    console.log("No Gemini embedding API calls will be made.");
    console.log(
      "Existing Gemini embeddings will be replaced because EMBEDDING_REEMBED_DIFFERENT_MODEL=true."
    );
  }

  let cycle = 0;
  let totalEmbeddedRows = 0;
  let totalEmbeddedUniqueTexts = 0;
  let totalReusedRows = 0;
  let totalFailedBatches = 0;
  let totalRateLimitHits = 0;

  while (true) {
    cycle += 1;

    const progressBefore = await getProgressCounts();

    console.log("");
    console.log(`Embedding cycle ${cycle}`);
    console.log({
      totalChunks: progressBefore.totalChunks,
      embeddedChunksAnyModel: progressBefore.embeddedChunks,
      currentModelEmbeddings: progressBefore.currentModelEmbeddings,
      targetMissingEmbeddings: progressBefore.targetMissingEmbeddings,
    });

    if (!refreshAll && progressBefore.targetMissingEmbeddings === 0) {
      console.log("All target chunks already have embeddings for the target model.");
      break;
    }

    const rows = await getChunksToEmbed();

    if (rows.length === 0) {
      console.log("No more chunks need embeddings.");
      break;
    }

    const preparedChunks = rows.map(prepareChunk).filter((chunk) => chunk.text);

    if (preparedChunks.length === 0) {
      console.log("No valid text found in selected chunks.");
      break;
    }

    const reusableResult = await copyReusableEmbeddings(preparedChunks);

    totalReusedRows += reusableResult.reused.length;

    if (reusableResult.reused.length > 0) {
      console.log({
        reusedRowsFromExistingTargetModelEmbeddings: reusableResult.reused.length,
      });
    }

    if (reusableResult.stillNeedEmbedding.length === 0) {
      const progressAfterReuse = await getProgressCounts();

      console.log("Cycle completed using reusable embeddings only.");
      console.log({
        totalChunks: progressAfterReuse.totalChunks,
        currentModelEmbeddings: progressAfterReuse.currentModelEmbeddings,
        targetMissingEmbeddings: progressAfterReuse.targetMissingEmbeddings,
      });

      if (!continueUntilDone) {
        break;
      }

      continue;
    }

    let batchCompleted = false;
    let rateLimitRetriesForBatch = 0;

    while (!batchCompleted) {
      try {
        const result = await embedPreparedChunks(
          reusableResult.stillNeedEmbedding
        );

        totalEmbeddedRows += result.embeddedRows;
        totalEmbeddedUniqueTexts += result.embeddedUniqueTexts;

        const progressAfter = await getProgressCounts();

        console.log({
          embeddedRowsThisCycle: result.embeddedRows,
          embeddedUniqueTextsThisCycle: result.embeddedUniqueTexts,
          reusedRowsThisCycle: reusableResult.reused.length,
          totalEmbeddedRows,
          totalEmbeddedUniqueTexts,
          totalReusedRows,
          totalChunks: progressAfter.totalChunks,
          embeddedChunksAnyModel: progressAfter.embeddedChunks,
          currentModelEmbeddings: progressAfter.currentModelEmbeddings,
          targetMissingEmbeddings: progressAfter.targetMissingEmbeddings,
        });

        batchCompleted = true;

        if (requestDelayMs > 0) {
          console.log(`Waiting ${formatWait(requestDelayMs)} before next batch...`);
          await sleep(requestDelayMs);
        }
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown embedding batch error";

        if (error instanceof EmbeddingRateLimitError) {
          totalRateLimitHits += 1;
          rateLimitRetriesForBatch += 1;

          if (rateLimitRetriesForBatch > maxRateLimitRetries) {
            throw new Error(
              `Exceeded max rate-limit retries for batch. Last error: ${message}`
            );
          }

          const waitMs = error.retryAfterMs ?? defaultRateLimitWaitMs;

          console.log("");
          console.log("Gemini rate limit/quota hit during batch embedding.");
          console.log({
            totalRateLimitHits,
            rateLimitRetriesForBatch,
            maxRateLimitRetries,
            retryAfterFromApiMs: error.retryAfterMs,
            waitMs,
          });
          console.log(`Waiting ${formatWait(waitMs)} before retrying same batch...`);
          console.log("Leave this terminal open. It will continue automatically.");
          console.log("");

          await sleep(waitMs);
          continue;
        }

        totalFailedBatches += 1;

        console.error("Embedding batch failed:", message);
        console.log("Stopping because this was not a rate-limit error.");

        throw error;
      }
    }

    if (!continueUntilDone) {
      console.log("EMBEDDING_CONTINUE_UNTIL_DONE=false, stopping after one batch.");
      break;
    }
  }

  const finalProgress = await getProgressCounts();

  console.log("");
  console.log("Optimized document chunk embedding build finished.");
  console.log({
    embeddingProvider,
    targetEmbeddingModel,
    totalEmbeddedRows,
    totalEmbeddedUniqueTexts,
    totalReusedRows,
    totalFailedBatches,
    totalRateLimitHits,
    totalChunks: finalProgress.totalChunks,
    embeddedChunksAnyModel: finalProgress.embeddedChunks,
    currentModelEmbeddings: finalProgress.currentModelEmbeddings,
    targetMissingEmbeddings: finalProgress.targetMissingEmbeddings,
  });
}

main().catch((error) => {
  console.error("Embedding build failed:", error);
  process.exit(1);
});