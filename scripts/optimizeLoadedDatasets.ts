import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is missing. Check .env.local.");
  }

  const { sql } = await import("../lib/db/client");

  console.log("Optimizing loaded datasets...");

  console.log("Rebuilding pgvector IVFFLAT index after embeddings are loaded...");
  await sql`drop index if exists idx_document_chunks_embedding_ivfflat`;

  await sql`
    create index if not exists idx_document_chunks_embedding_ivfflat
    on document_chunks using ivfflat (embedding vector_cosine_ops)
    with (lists = 100)
  `;

  console.log("Running ANALYZE on loaded dataset tables...");

  await sql`analyze cms_part_d_spending`;
  await sql`analyze cms_part_d_prescribers`;
  await sql`analyze open_payments`;
  await sql`analyze pharma_sales`;
  await sql`analyze documents`;
  await sql`analyze document_chunks`;

  console.log("Dataset optimization complete.");
}

main().catch((error) => {
  console.error("Dataset optimization failed:", error);
  process.exit(1);
});