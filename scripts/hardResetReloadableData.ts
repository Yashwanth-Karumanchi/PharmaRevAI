import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const reloadableTables = [
  "document_chunks",
  "documents",
  "cms_part_d_prescribers",
  "cms_part_d_spending",
  "open_payments",
  "pharma_sales",
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

  const exists = await tableExists(tableName);

  if (!exists) {
    return "missing";
  }

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

  console.log("Hard resetting reloadable PharmaRev dataset tables...");
  console.log("Protected: chats, messages, users, feedback, auth/session tables, and app metadata.");

  console.log({
    databaseSizeBeforeMb: await databaseSizeMb(),
  });

  const before = [];

  for (const tableName of reloadableTables) {
    before.push({
      tableName,
      rows: await countRows(tableName),
    });
  }

  console.log("Before hard reset:");
  console.table(before);

  console.log("Dropping reloadable dataset tables with cascade...");

  for (const tableName of reloadableTables) {
    await sql.unsafe(`drop table if exists "${tableName}" cascade`);
  }

  const after = [];

  for (const tableName of reloadableTables) {
    after.push({
      tableName,
      rows: await countRows(tableName),
    });
  }

  console.log("After hard reset:");
  console.table(after);

  console.log({
    databaseSizeAfterMb: await databaseSizeMb(),
  });

  console.log("Hard reset complete. Now run setup:max-schema before Option B rebuild.");
}

main().catch((error) => {
  console.error("Hard reset failed:", error);
  process.exit(1);
});