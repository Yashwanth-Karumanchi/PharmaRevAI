import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

async function main() {
  const { sql } = await import("../lib/db/client");

  console.log("Preparing pgvector RAG schema...");

  await sql`
    create extension if not exists vector
  `;

  await sql`
    alter table document_chunks
    add column if not exists embedding vector(768)
  `;

  await sql`
    alter table document_chunks
    add column if not exists embedding_model text
  `;

  await sql`
    alter table document_chunks
    add column if not exists embedding_updated_at timestamptz
  `;

  await sql`
    alter table document_chunks
    add column if not exists embedding_source_text_hash text
  `;

  await sql`
    create index if not exists idx_document_chunks_embedding_ivfflat
    on document_chunks
    using ivfflat (embedding vector_cosine_ops)
    with (lists = 100)
  `;

  await sql`
    create index if not exists idx_document_chunks_embedding_model
    on document_chunks (embedding_model)
  `;

  await sql`
    create index if not exists idx_document_chunks_embedding_hash
    on document_chunks (embedding_source_text_hash)
  `;

  console.log("pgvector RAG schema ready.");
}

main().catch((error) => {
  console.error("Failed to prepare pgvector RAG schema:", error);
  process.exit(1);
});