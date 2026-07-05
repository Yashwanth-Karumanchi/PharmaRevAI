import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const tables = [
  "documents",
  "document_chunks",
  "cms_part_d_spending",
  "cms_part_d_prescribers",
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

async function getRowCount(tableName: string) {
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

  const counts = [];

  for (const table of tables) {
    const exists = await tableExists(table);

    counts.push({
      table,
      exists,
      rows: exists ? await getRowCount(table) : "missing",
    });
  }

  console.log("");
  console.log("Dataset counts:");
  console.table(counts);

  const { sql } = await import("../lib/db/client");

  if (await tableExists("document_chunks")) {
    const embeddings = await sql`
      select
        source_type,
        count(*)::text as total_chunks,
        count(*) filter (where embedding is not null)::text as embedded_chunks,
        count(*) filter (where embedding_model = 'Xenova/bge-base-en-v1.5')::text as bge_chunks,
        count(*) filter (where embedding_model = 'gemini-embedding-2')::text as gemini_chunks,
        count(*) filter (where embedding is null)::text as missing_embeddings
      from document_chunks
      group by source_type
      order by count(*) desc
    `;

    console.log("");
    console.log("Embedding counts:");
    console.table(embeddings);
  }

  if (await tableExists("documents")) {
    const sampleDrugs = await sql`
      select
        coalesce(metadata->>'brandName', metadata->>'drugName', title) as drug,
        count(*)::text as documents
      from documents
      where source_type = 'drug_label'
      group by drug
      order by count(*) desc
      limit 25
    `;

    console.log("");
    console.log("Top loaded FDA label drugs:");
    console.table(sampleDrugs);
  }
}

main().catch((error) => {
  console.error("Dataset count check failed:", error);
  process.exit(1);
});