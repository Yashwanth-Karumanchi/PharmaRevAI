import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

async function databaseSizeMb() {
  const { sql } = await import("../lib/db/client");

  const rows = await sql<{ size_mb: string }[]>`
    select round(pg_database_size(current_database()) / 1024.0 / 1024.0, 2)::text as size_mb
  `;

  return Number(rows[0]?.size_mb || 0);
}

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is missing. Check .env.local.");
  }

  const { sql } = await import("../lib/db/client");

  console.log("Optimizing Option B compact database...");
  console.log({
    startingSizeMb: await databaseSizeMb(),
  });

  const indexStatements = [
    `create unique index if not exists idx_cms_part_d_spending_row_hash on cms_part_d_spending (row_hash)`,
    `create index if not exists idx_cms_part_d_spending_year_total on cms_part_d_spending (year, total_spending desc)`,
    `create index if not exists idx_cms_part_d_spending_year_brand on cms_part_d_spending (year, brand_name)`,
    `create index if not exists idx_cms_part_d_spending_brand_lower on cms_part_d_spending (lower(brand_name))`,

    `create unique index if not exists idx_cms_part_d_prescribers_row_hash on cms_part_d_prescribers (row_hash)`,
    `create index if not exists idx_cms_prescribers_year_brand on cms_part_d_prescribers (year, brand_name)`,
    `create index if not exists idx_cms_prescribers_brand_cost on cms_part_d_prescribers (brand_name, total_drug_cost desc)`,
    `create index if not exists idx_cms_prescribers_state on cms_part_d_prescribers (provider_state)`,
    `create index if not exists idx_cms_prescribers_specialty on cms_part_d_prescribers (provider_specialty)`,

    `create index if not exists idx_open_payments_amount on open_payments (payment_amount desc)`,
    `create index if not exists idx_open_payments_company_lower on open_payments (lower(company_name))`,
    `create index if not exists idx_open_payments_state on open_payments (recipient_state)`,
    `create index if not exists idx_open_payments_specialty on open_payments (physician_specialty)`,

    `create unique index if not exists idx_pharma_sales_row_hash on pharma_sales (row_hash)`,
    `create index if not exists idx_pharma_sales_category_date on pharma_sales (atc_category, sale_date)`,
    `create index if not exists idx_pharma_sales_year_month on pharma_sales (sale_year, sale_month)`,

    `create unique index if not exists idx_documents_source_external on documents (source_type, external_id) nulls not distinct`,
    `create index if not exists idx_documents_source_type on documents (source_type)`,

    `create index if not exists idx_document_chunks_source_type on document_chunks (source_type)`,
    `create index if not exists idx_document_chunks_document_id on document_chunks (document_id)`,
    `create index if not exists idx_document_chunks_embedding_model on document_chunks (embedding_model)`,
  ];

  for (const statement of indexStatements) {
    await sql.unsafe(statement);
  }

  const chunkCountRows = await sql<{ count: string }[]>`
    select count(*)::text as count
    from document_chunks
    where embedding is not null
  `;

  const embeddedChunkCount = Number(chunkCountRows[0]?.count || 0);

  if (embeddedChunkCount >= 1000) {
    console.log("Creating compact IVFFLAT vector index after embeddings...");
    await sql`drop index if exists idx_document_chunks_embedding_ivfflat`;

    await sql`
      create index idx_document_chunks_embedding_ivfflat
      on document_chunks using ivfflat (embedding vector_cosine_ops)
      with (lists = 30)
    `;
  } else {
    console.log("Skipping vector index because embedded chunk count is low.");
  }

  const tables = [
    "cms_part_d_spending",
    "cms_part_d_prescribers",
    "open_payments",
    "pharma_sales",
    "documents",
    "document_chunks",
  ];

  for (const table of tables) {
    await sql.unsafe(`analyze "${table}"`);
  }

  console.log({
    finalSizeMb: await databaseSizeMb(),
  });

  console.log("Option B optimization complete.");
}

main().catch((error) => {
  console.error("Option B optimization failed:", error);
  process.exit(1);
});