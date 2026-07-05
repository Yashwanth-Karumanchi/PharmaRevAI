import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

async function main() {
  const { sql } = await import("../lib/db/client");

  console.log("Preparing Pharma Sales schema...");

  await sql`
    create table if not exists pharma_sales (
      id bigserial primary key,
      row_hash text unique,
      sale_timestamp timestamptz,
      sale_date date,
      sale_year int,
      sale_month int,
      drug_name text,
      atc_category text,
      quantity_sold numeric,
      source_dataset text,
      source_file text,
      metadata jsonb default '{}'::jsonb,
      created_at timestamptz default now()
    )
  `;

  await sql`alter table pharma_sales add column if not exists row_hash text`;
  await sql`alter table pharma_sales add column if not exists sale_timestamp timestamptz`;
  await sql`alter table pharma_sales add column if not exists sale_date date`;
  await sql`alter table pharma_sales add column if not exists sale_year int`;
  await sql`alter table pharma_sales add column if not exists sale_month int`;
  await sql`alter table pharma_sales add column if not exists drug_name text`;
  await sql`alter table pharma_sales add column if not exists atc_category text`;
  await sql`alter table pharma_sales add column if not exists quantity_sold numeric`;
  await sql`alter table pharma_sales add column if not exists source_dataset text`;
  await sql`alter table pharma_sales add column if not exists source_file text`;
  await sql`alter table pharma_sales add column if not exists metadata jsonb default '{}'::jsonb`;
  await sql`alter table pharma_sales add column if not exists created_at timestamptz default now()`;

  await sql`
    create unique index if not exists idx_pharma_sales_row_hash
    on pharma_sales (row_hash)
  `;

  await sql`
    create index if not exists idx_pharma_sales_date
    on pharma_sales (sale_date)
  `;

  await sql`
    create index if not exists idx_pharma_sales_year_month
    on pharma_sales (sale_year, sale_month)
  `;

  await sql`
    create index if not exists idx_pharma_sales_drug
    on pharma_sales (drug_name)
  `;

  await sql`
    create index if not exists idx_pharma_sales_category
    on pharma_sales (atc_category)
  `;

  await sql`
    create index if not exists idx_pharma_sales_metadata_gin
    on pharma_sales using gin (metadata)
  `;

  console.log("Pharma Sales schema ready.");
}

main().catch((error) => {
  console.error("Failed to prepare Pharma Sales schema:", error);
  process.exit(1);
});