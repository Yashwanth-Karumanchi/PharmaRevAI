import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is missing. Check .env.local.");
  }

  const { sql } = await import("../lib/db/client");

  console.log("Setting up max PharmaRev schema...");

  await sql`create extension if not exists pgcrypto`;
  await sql`create extension if not exists vector`;
  await sql`create extension if not exists pg_trgm`;

  await sql`
    create table if not exists cms_part_d_spending (
      id bigserial primary key,
      row_hash text,
      year int,
      brand_name text,
      generic_name text,
      manufacturer text,
      total_spending numeric,
      total_claims numeric,
      total_beneficiaries numeric,
      total_dosage_units numeric,
      avg_spending_per_dosage_unit numeric,
      avg_spending_per_claim numeric,
      change_avg_spend_per_dosage_unit numeric,
      source_dataset text,
      source_url text,
      metadata jsonb default '{}'::jsonb,
      created_at timestamptz default now()
    )
  `;

  await sql`
    create table if not exists cms_part_d_prescribers (
      id bigserial primary key,
      row_hash text,
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
    create table if not exists open_payments (
      id bigserial primary key,
      row_hash text,
      program_year int,
      company_name text,
      covered_recipient_type text,
      recipient_name text,
      recipient_npi text,
      physician_specialty text,
      recipient_city text,
      recipient_state text,
      payment_amount numeric,
      payment_nature text,
      payment_form text,
      drug_or_device_name text,
      date_of_payment date,
      source_dataset text,
      source_url text,
      metadata jsonb default '{}'::jsonb,
      created_at timestamptz default now()
    )
  `;

  await sql`
    create table if not exists pharma_sales (
      id bigserial primary key,
      row_hash text,
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

  await sql`
    create table if not exists documents (
      id uuid primary key default gen_random_uuid(),
      source_type text not null,
      source_dataset text,
      external_id text,
      title text,
      source_url text,
      metadata jsonb default '{}'::jsonb,
      created_at timestamptz default now(),
      updated_at timestamptz default now()
    )
  `;

  await sql`
    create table if not exists document_chunks (
      id uuid primary key default gen_random_uuid(),
      document_id uuid references documents(id) on delete cascade,
      source_type text not null,
      chunk_text text not null,
      section text,
      chunk_index integer,
      metadata jsonb default '{}'::jsonb,
      embedding vector(768),
      embedding_model text,
      embedding_updated_at timestamptz,
      embedding_source_text_hash text,
      created_at timestamptz default now()
    )
  `;

  const alterStatements = [
    `alter table cms_part_d_spending add column if not exists row_hash text`,
    `alter table cms_part_d_spending add column if not exists year int`,
    `alter table cms_part_d_spending add column if not exists brand_name text`,
    `alter table cms_part_d_spending add column if not exists generic_name text`,
    `alter table cms_part_d_spending add column if not exists manufacturer text`,
    `alter table cms_part_d_spending add column if not exists total_spending numeric`,
    `alter table cms_part_d_spending add column if not exists total_claims numeric`,
    `alter table cms_part_d_spending add column if not exists total_beneficiaries numeric`,
    `alter table cms_part_d_spending add column if not exists total_dosage_units numeric`,
    `alter table cms_part_d_spending add column if not exists avg_spending_per_dosage_unit numeric`,
    `alter table cms_part_d_spending add column if not exists avg_spending_per_claim numeric`,
    `alter table cms_part_d_spending add column if not exists change_avg_spend_per_dosage_unit numeric`,
    `alter table cms_part_d_spending add column if not exists source_dataset text`,
    `alter table cms_part_d_spending add column if not exists source_url text`,
    `alter table cms_part_d_spending add column if not exists metadata jsonb default '{}'::jsonb`,

    `alter table cms_part_d_prescribers add column if not exists row_hash text`,
    `alter table cms_part_d_prescribers add column if not exists year int`,
    `alter table cms_part_d_prescribers add column if not exists npi text`,
    `alter table cms_part_d_prescribers add column if not exists provider_name text`,
    `alter table cms_part_d_prescribers add column if not exists provider_city text`,
    `alter table cms_part_d_prescribers add column if not exists provider_state text`,
    `alter table cms_part_d_prescribers add column if not exists provider_specialty text`,
    `alter table cms_part_d_prescribers add column if not exists brand_name text`,
    `alter table cms_part_d_prescribers add column if not exists generic_name text`,
    `alter table cms_part_d_prescribers add column if not exists total_claim_count numeric`,
    `alter table cms_part_d_prescribers add column if not exists total_30day_fills numeric`,
    `alter table cms_part_d_prescribers add column if not exists total_drug_cost numeric`,
    `alter table cms_part_d_prescribers add column if not exists beneficiary_count numeric`,
    `alter table cms_part_d_prescribers add column if not exists source_dataset text`,
    `alter table cms_part_d_prescribers add column if not exists source_url text`,
    `alter table cms_part_d_prescribers add column if not exists metadata jsonb default '{}'::jsonb`,

    `alter table open_payments add column if not exists row_hash text`,
    `alter table open_payments add column if not exists program_year int`,
    `alter table open_payments add column if not exists company_name text`,
    `alter table open_payments add column if not exists covered_recipient_type text`,
    `alter table open_payments add column if not exists recipient_name text`,
    `alter table open_payments add column if not exists recipient_npi text`,
    `alter table open_payments add column if not exists physician_specialty text`,
    `alter table open_payments add column if not exists recipient_city text`,
    `alter table open_payments add column if not exists recipient_state text`,
    `alter table open_payments add column if not exists payment_amount numeric`,
    `alter table open_payments add column if not exists payment_nature text`,
    `alter table open_payments add column if not exists payment_form text`,
    `alter table open_payments add column if not exists drug_or_device_name text`,
    `alter table open_payments add column if not exists date_of_payment date`,
    `alter table open_payments add column if not exists source_dataset text`,
    `alter table open_payments add column if not exists source_url text`,
    `alter table open_payments add column if not exists metadata jsonb default '{}'::jsonb`,

    `alter table pharma_sales add column if not exists row_hash text`,
    `alter table pharma_sales add column if not exists sale_timestamp timestamptz`,
    `alter table pharma_sales add column if not exists sale_date date`,
    `alter table pharma_sales add column if not exists sale_year int`,
    `alter table pharma_sales add column if not exists sale_month int`,
    `alter table pharma_sales add column if not exists drug_name text`,
    `alter table pharma_sales add column if not exists atc_category text`,
    `alter table pharma_sales add column if not exists quantity_sold numeric`,
    `alter table pharma_sales add column if not exists source_dataset text`,
    `alter table pharma_sales add column if not exists source_file text`,
    `alter table pharma_sales add column if not exists metadata jsonb default '{}'::jsonb`,

    `alter table documents add column if not exists source_type text`,
    `alter table documents add column if not exists source_dataset text`,
    `alter table documents add column if not exists external_id text`,
    `alter table documents add column if not exists title text`,
    `alter table documents add column if not exists source_url text`,
    `alter table documents add column if not exists metadata jsonb default '{}'::jsonb`,
    `alter table documents add column if not exists updated_at timestamptz default now()`,

    `alter table document_chunks add column if not exists source_type text`,
    `alter table document_chunks add column if not exists chunk_text text`,
    `alter table document_chunks add column if not exists section text`,
    `alter table document_chunks add column if not exists chunk_index integer`,
    `alter table document_chunks add column if not exists metadata jsonb default '{}'::jsonb`,
    `alter table document_chunks add column if not exists embedding vector(768)`,
    `alter table document_chunks add column if not exists embedding_model text`,
    `alter table document_chunks add column if not exists embedding_updated_at timestamptz`,
    `alter table document_chunks add column if not exists embedding_source_text_hash text`,
  ];

  for (const statement of alterStatements) {
    await sql.unsafe(statement);
  }

  const indexStatements = [
    `create unique index if not exists idx_cms_part_d_spending_row_hash on cms_part_d_spending (row_hash)`,
    `create index if not exists idx_cms_part_d_spending_brand_trgm on cms_part_d_spending using gin (brand_name gin_trgm_ops)`,
    `create index if not exists idx_cms_part_d_spending_generic_trgm on cms_part_d_spending using gin (generic_name gin_trgm_ops)`,
    `create index if not exists idx_cms_part_d_spending_year_brand on cms_part_d_spending (year, brand_name)`,
    `create index if not exists idx_cms_part_d_spending_total on cms_part_d_spending (total_spending desc)`,

    `create unique index if not exists idx_cms_part_d_prescribers_row_hash on cms_part_d_prescribers (row_hash)`,
    `create index if not exists idx_cms_prescribers_brand_trgm on cms_part_d_prescribers using gin (brand_name gin_trgm_ops)`,
    `create index if not exists idx_cms_prescribers_generic_trgm on cms_part_d_prescribers using gin (generic_name gin_trgm_ops)`,
    `create index if not exists idx_cms_prescribers_state on cms_part_d_prescribers (provider_state)`,
    `create index if not exists idx_cms_prescribers_specialty on cms_part_d_prescribers (provider_specialty)`,
    `create index if not exists idx_cms_prescribers_brand_cost on cms_part_d_prescribers (brand_name, total_drug_cost desc)`,
    `create index if not exists idx_cms_prescribers_year_brand on cms_part_d_prescribers (year, brand_name)`,

    `create unique index if not exists idx_open_payments_row_hash on open_payments (row_hash)`,
    `create index if not exists idx_open_payments_company_trgm on open_payments using gin (company_name gin_trgm_ops)`,
    `create index if not exists idx_open_payments_specialty on open_payments (physician_specialty)`,
    `create index if not exists idx_open_payments_state on open_payments (recipient_state)`,
    `create index if not exists idx_open_payments_amount on open_payments (payment_amount desc)`,
    `create index if not exists idx_open_payments_drug_trgm on open_payments using gin (drug_or_device_name gin_trgm_ops)`,

    `create unique index if not exists idx_pharma_sales_row_hash on pharma_sales (row_hash)`,
    `create index if not exists idx_pharma_sales_category_date on pharma_sales (atc_category, sale_date)`,
    `create index if not exists idx_pharma_sales_year_month on pharma_sales (sale_year, sale_month)`,
    `create index if not exists idx_pharma_sales_quantity on pharma_sales (quantity_sold desc)`,

    `create unique index if not exists idx_documents_source_external on documents (source_type, external_id) nulls not distinct`,
    `create index if not exists idx_documents_source_type on documents (source_type)`,
    `create index if not exists idx_documents_title_trgm on documents using gin (title gin_trgm_ops)`,

    `create index if not exists idx_document_chunks_source_type on document_chunks (source_type)`,
    `create index if not exists idx_document_chunks_document_id on document_chunks (document_id)`,
    `create index if not exists idx_document_chunks_section on document_chunks (section)`,
    `create index if not exists idx_document_chunks_text_trgm on document_chunks using gin (chunk_text gin_trgm_ops)`,
    `create index if not exists idx_document_chunks_embedding_model on document_chunks (embedding_model)`,
    `create index if not exists idx_document_chunks_embedding_ivfflat on document_chunks using ivfflat (embedding vector_cosine_ops) with (lists = 100)`,
  ];

  for (const statement of indexStatements) {
    await sql.unsafe(statement);
  }

  console.log("Max PharmaRev schema setup complete.");
}

main().catch((error) => {
  console.error("Max schema setup failed:", error);
  process.exit(1);
});