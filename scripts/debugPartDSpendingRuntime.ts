import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

function maskDatabaseUrl(value: string | undefined) {
  if (!value) return "missing";

  try {
    const url = new URL(value);
    return `${url.protocol}//${url.username ? "***" : ""}${url.username ? "@" : ""}${url.hostname}${url.pathname}`;
  } catch {
    return "loaded-but-unparseable";
  }
}

async function main() {
  const { sql } = await import("../lib/db/client");

  console.log("DATABASE_URL runtime fingerprint:");
  console.log(maskDatabaseUrl(process.env.DATABASE_URL));

  console.log("\nYear counts from app runtime:");
  const yearCounts = await sql`
    select year, count(*)::int as count
    from cms_part_d_spending
    group by year
    order by year
  `;
  console.table(yearCounts);

  console.log("\nTotal rows from app runtime:");
  const totalRows = await sql`
    select count(*)::int as count
    from cms_part_d_spending
  `;
  console.table(totalRows);

  console.log("\nTop spending rows from app runtime:");
  const topRows = await sql`
    select
      brand_name,
      generic_name,
      manufacturer,
      total_spending,
      year
    from cms_part_d_spending
    where year = 2024
      and total_spending is not null
    order by total_spending desc nulls last
    limit 10
  `;
  console.table(topRows);

  console.log("\nTrying Part D spending agent runtime:");
  const module = await import("../lib/agents/partDSpendingAgent");

  const fn =
    (module as Record<string, any>).answerPartDTopSpendingQuestion ||
    (module as Record<string, any>).answerTopPartDSpendingQuestion ||
    (module as Record<string, any>).answerPartDQuestion;

  if (!fn) {
    throw new Error(
      "Could not find Part D top spending agent export. Check partDSpendingAgent.ts exports."
    );
  }

  const result = await fn("Which drugs had the highest Medicare Part D spending in 2024?");

  console.log("\nAgent answer:");
  console.log(result.answer);

  console.log("\nAgent row count:");
  console.log(Array.isArray(result.rows) ? result.rows.length : "rows missing");

  console.log("\nAgent SQL query:");
  console.log(result.sqlQuery || "sqlQuery missing");

  console.log("\nAgent sources:");
  console.dir(result.sources, { depth: 4 });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});