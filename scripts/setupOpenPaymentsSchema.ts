import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

async function main() {
  const { sql } = await import("../lib/db/client");

  console.log("Preparing Open Payments schema...");

  await sql`
    create table if not exists open_payments (
      id bigserial primary key,
      row_hash text unique,
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

  await sql`alter table open_payments add column if not exists row_hash text`;
  await sql`alter table open_payments add column if not exists program_year int`;
  await sql`alter table open_payments add column if not exists company_name text`;
  await sql`alter table open_payments add column if not exists covered_recipient_type text`;
  await sql`alter table open_payments add column if not exists recipient_name text`;
  await sql`alter table open_payments add column if not exists recipient_npi text`;
  await sql`alter table open_payments add column if not exists physician_specialty text`;
  await sql`alter table open_payments add column if not exists recipient_city text`;
  await sql`alter table open_payments add column if not exists recipient_state text`;
  await sql`alter table open_payments add column if not exists payment_amount numeric`;
  await sql`alter table open_payments add column if not exists payment_nature text`;
  await sql`alter table open_payments add column if not exists payment_form text`;
  await sql`alter table open_payments add column if not exists drug_or_device_name text`;
  await sql`alter table open_payments add column if not exists date_of_payment date`;
  await sql`alter table open_payments add column if not exists source_dataset text`;
  await sql`alter table open_payments add column if not exists source_url text`;
  await sql`alter table open_payments add column if not exists metadata jsonb default '{}'::jsonb`;
  await sql`alter table open_payments add column if not exists created_at timestamptz default now()`;

  await sql`
    create unique index if not exists idx_open_payments_row_hash
    on open_payments (row_hash)
  `;

  await sql`
    create index if not exists idx_open_payments_year
    on open_payments (program_year)
  `;

  await sql`
    create index if not exists idx_open_payments_company
    on open_payments (company_name)
  `;

  await sql`
    create index if not exists idx_open_payments_specialty
    on open_payments (physician_specialty)
  `;

  await sql`
    create index if not exists idx_open_payments_state
    on open_payments (recipient_state)
  `;

  await sql`
    create index if not exists idx_open_payments_product
    on open_payments (drug_or_device_name)
  `;

  await sql`
    create index if not exists idx_open_payments_metadata_gin
    on open_payments using gin (metadata)
  `;

  console.log("Open Payments schema ready.");
}

main().catch((error) => {
  console.error("Failed to prepare Open Payments schema:", error);
  process.exit(1);
});