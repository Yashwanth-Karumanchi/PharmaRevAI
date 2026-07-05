import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const reloadableTables = [
  "document_chunks",
  "documents",
  "cms_part_d_prescribers",
  "open_payments",
  "pharma_sales",
  "cms_part_d_spending",
];

const heavyIndexes = [
  "idx_open_payments_company_trgm",
  "idx_open_payments_drug_trgm",
  "idx_open_payments_amount",
  "idx_open_payments_specialty",
  "idx_open_payments_state",

  "idx_cms_prescribers_brand_trgm",
  "idx_cms_prescribers_generic_trgm",

  "idx_cms_part_d_spending_brand_trgm",
  "idx_cms_part_d_spending_generic_trgm",

  "idx_documents_title_trgm",
  "idx_document_chunks_text_trgm",
  "idx_document_chunks_embedding_ivfflat",
];

async function tableExists(tableName: string) {
  const { sql } = await import("../lib/db/client");

  const rows = await sql<{ exists: boolean }[]>`
    select exists (
      select 1
      from information_schema.tables
      where table_schema = 'public'
        and table_name = ${tableName}
    ) as exists
  `;

  return Boolean(rows[0]?.exists);
}

async function countRows(tableName: string) {
  const { sql } = await import("../lib/db/client");

  const rows = await sql.unsafe<{ count: string }[]>(
    `select count(*)::text as count from "${tableName}"`
  );

  return rows[0]?.count ?? "0";
}

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

  console.log("Preparing Option B compact database...");
  console.log({
    currentSizeMb: await databaseSizeMb(),
    neonLimitMb: process.env.NEON_PROJECT_SIZE_LIMIT_MB || "512",
    chatReserveMb: process.env.NEON_CHAT_RESERVE_MB || "100",
    emergencyReserveMb: process.env.NEON_EMERGENCY_RESERVE_MB || "30",
  });

  console.log("Dropping heavy/rebuildable indexes first...");
  for (const indexName of heavyIndexes) {
    await sql.unsafe(`drop index if exists "${indexName}"`);
  }

  const existingTables: string[] = [];
  const before = [];

  for (const tableName of reloadableTables) {
    const exists = await tableExists(tableName);
    const rows = exists ? await countRows(tableName) : "missing";

    before.push({ tableName, exists, rows });

    if (exists) {
      existingTables.push(tableName);
    }
  }

  console.log("Reloadable dataset tables before reset:");
  console.table(before);

  if (existingTables.length > 0) {
    const tableList = existingTables.map((table) => `"${table}"`).join(", ");
    await sql.unsafe(`truncate table ${tableList} restart identity cascade`);
  }

  for (const tableName of existingTables) {
    await sql.unsafe(`vacuum analyze "${tableName}"`);
  }

  const after = [];

  for (const tableName of reloadableTables) {
    const exists = await tableExists(tableName);
    const rows = exists ? await countRows(tableName) : "missing";
    after.push({ tableName, exists, rows });
  }

  console.log("Reloadable dataset tables after reset:");
  console.table(after);

  console.log({
    finalSizeMb: await databaseSizeMb(),
  });

  console.log("Option B preparation complete. Chats/app tables were not touched.");
}

main().catch((error) => {
  console.error("Option B preparation failed:", error);
  process.exit(1);
});