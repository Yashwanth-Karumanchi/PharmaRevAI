import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

async function main() {
  const { sql } = await import("../lib/db/client");

  console.log("Preparing CMS Part D Prescribers schema...");

  await sql`
    create table if not exists cms_part_d_prescribers (
      id bigserial primary key,
      year int,
      npi text,
      provider_name text,
      provider_city text,
      provider_state text,
      provider_specialty text,
      brand_name text,
      generic_name text,
      total_claim_count numeric,
      total_30day_fills numeric,
      total_drug_cost numeric,
      beneficiary_count numeric,
      source_dataset text,
      source_url text,
      metadata jsonb default '{}'::jsonb,
      created_at timestamptz default now()
    )
  `;

  await sql`
    alter table cms_part_d_prescribers
    add column if not exists year int
  `;

  await sql`
    alter table cms_part_d_prescribers
    add column if not exists npi text
  `;

  await sql`
    alter table cms_part_d_prescribers
    add column if not exists provider_name text
  `;

  await sql`
    alter table cms_part_d_prescribers
    add column if not exists provider_city text
  `;

  await sql`
    alter table cms_part_d_prescribers
    add column if not exists provider_state text
  `;

  await sql`
    alter table cms_part_d_prescribers
    add column if not exists provider_specialty text
  `;

  await sql`
    alter table cms_part_d_prescribers
    add column if not exists brand_name text
  `;

  await sql`
    alter table cms_part_d_prescribers
    add column if not exists generic_name text
  `;

  await sql`
    alter table cms_part_d_prescribers
    add column if not exists total_claim_count numeric
  `;

  await sql`
    alter table cms_part_d_prescribers
    add column if not exists total_30day_fills numeric
  `;

  await sql`
    alter table cms_part_d_prescribers
    add column if not exists total_drug_cost numeric
  `;

  await sql`
    alter table cms_part_d_prescribers
    add column if not exists beneficiary_count numeric
  `;

  await sql`
    alter table cms_part_d_prescribers
    add column if not exists source_dataset text
  `;

  await sql`
    alter table cms_part_d_prescribers
    add column if not exists source_url text
  `;

  await sql`
    alter table cms_part_d_prescribers
    add column if not exists metadata jsonb default '{}'::jsonb
  `;

  await sql`
    alter table cms_part_d_prescribers
    add column if not exists created_at timestamptz default now()
  `;

  await sql`
    drop index if exists idx_cms_prescribers_unique_row
  `;

  await sql`
    create unique index if not exists idx_cms_prescribers_unique_row
    on cms_part_d_prescribers (
      year,
      npi,
      brand_name,
      generic_name
    )
    nulls not distinct
  `;

  await sql`
    create index if not exists idx_cms_prescribers_year
    on cms_part_d_prescribers (year)
  `;

  await sql`
    create index if not exists idx_cms_prescribers_brand
    on cms_part_d_prescribers (brand_name)
  `;

  await sql`
    create index if not exists idx_cms_prescribers_generic
    on cms_part_d_prescribers (generic_name)
  `;

  await sql`
    create index if not exists idx_cms_prescribers_state
    on cms_part_d_prescribers (provider_state)
  `;

  await sql`
    create index if not exists idx_cms_prescribers_npi
    on cms_part_d_prescribers (npi)
  `;

  await sql`
    create index if not exists idx_cms_prescribers_specialty
    on cms_part_d_prescribers (provider_specialty)
  `;

  await sql`
    create index if not exists idx_cms_prescribers_metadata_gin
    on cms_part_d_prescribers using gin (metadata)
  `;

  console.log("CMS Part D Prescribers schema ready.");
}

main().catch((error) => {
  console.error("Failed to prepare CMS Part D Prescribers schema:", error);
  process.exit(1);
});