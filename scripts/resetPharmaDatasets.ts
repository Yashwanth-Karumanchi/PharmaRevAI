import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const baseReloadableTables = [
  "document_chunks",
  "documents",
  "cms_part_d_prescribers",
  "open_payments",
  "pharma_sales",
];

const optionalReloadableTables = ["cms_part_d_spending"];

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

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is missing. Check .env.local.");
  }

  const resetPartDSpending = process.env.RESET_CMS_PARTD_SPENDING === "true";
  const targetTables = resetPartDSpending
    ? [...baseReloadableTables, ...optionalReloadableTables]
    : baseReloadableTables;

  console.log("Resetting reloadable PharmaRev dataset tables only.");
  console.log({
    resetPartDSpending,
    protectedTables:
      "chat history, feedback, app/user metadata, and auth/session tables are not touched",
  });

  const existingTables: string[] = [];
  const before = [];

  for (const tableName of targetTables) {
    const exists = await tableExists(tableName);
    const rows = exists ? await countRows(tableName) : "missing";

    before.push({ tableName, exists, rows });

    if (exists) {
      existingTables.push(tableName);
    }
  }

  console.log("Before reset:");
  console.table(before);

  if (existingTables.length > 0) {
    const { sql } = await import("../lib/db/client");
    const tableList = existingTables.map((table) => `"${table}"`).join(", ");

    await sql.unsafe(`truncate table ${tableList} restart identity cascade`);
  }

  const after = [];

  for (const tableName of targetTables) {
    const exists = await tableExists(tableName);
    const rows = exists ? await countRows(tableName) : "missing";

    after.push({ tableName, exists, rows });
  }

  console.log("After reset:");
  console.table(after);
}

main().catch((error) => {
  console.error("Dataset reset failed:", error);
  process.exit(1);
});