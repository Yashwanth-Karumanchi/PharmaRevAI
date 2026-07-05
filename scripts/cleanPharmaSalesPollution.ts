import dotenv from "dotenv";

dotenv.config({ path: ".env.local", override: true });

const pollutedCategories = ["YEAR", "MONTH", "HOUR", "WEEKDAY"];

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is missing.");
  }

  const { sql } = await import("../lib/db/client");

  console.log("Checking polluted pharma_sales categories...");

  const before = await sql`
    select
      atc_category,
      count(*)::int as row_count,
      sum(quantity_sold)::numeric(18, 2) as total_quantity
    from pharma_sales
    where upper(coalesce(atc_category, '')) in ${sql(pollutedCategories)}
    group by atc_category
    order by row_count desc
  `;

  console.log("Before cleanup:");
  console.table(before);

  await sql`
    delete from pharma_sales
    where upper(coalesce(atc_category, '')) in ${sql(pollutedCategories)}
  `;

  const after = await sql`
    select
      atc_category,
      count(*)::int as row_count,
      sum(quantity_sold)::numeric(18, 2) as total_quantity
    from pharma_sales
    where upper(coalesce(atc_category, '')) in ${sql(pollutedCategories)}
    group by atc_category
    order by row_count desc
  `;

  console.log("After cleanup:");
  console.table(after);

  const topCategories = await sql`
    select
      atc_category,
      sum(quantity_sold)::numeric(18, 2) as total_quantity_sold,
      count(*)::int as row_count,
      min(sale_year)::int as min_year,
      max(sale_year)::int as max_year
    from pharma_sales
    where quantity_sold is not null
      and atc_category is not null
      and upper(atc_category) not in ${sql(pollutedCategories)}
    group by atc_category
    order by sum(quantity_sold) desc nulls last
    limit 10
  `;

  console.log("Top clean sales categories:");
  console.table(topCategories);

  console.log("Pharma sales pollution cleanup complete.");
}

main().catch((error) => {
  console.error("Pharma sales cleanup failed:");
  console.error(error);
  process.exit(1);
});