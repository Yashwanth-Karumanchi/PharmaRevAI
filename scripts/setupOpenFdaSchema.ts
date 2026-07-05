import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

async function main() {
  const { sql } = await import("../lib/db/client");

  console.log("Preparing openFDA-compatible knowledge-base schema...");

  await sql`
    create extension if not exists pgcrypto
  `;

  await sql`
    create table if not exists documents (
      id uuid primary key default gen_random_uuid(),
      source_name text,
      source_type text,
      dataset_name text,
      title text,
      drug_name text,
      manufacturer text,
      year int,
      url text,
      metadata jsonb default '{}'::jsonb,
      created_at timestamptz default now()
    )
  `;

  await sql`
    create table if not exists document_chunks (
      id uuid primary key default gen_random_uuid(),
      document_id uuid references documents(id) on delete cascade,
      chunk_text text not null,
      chunk_index int,
      drug_name text,
      manufacturer text,
      source_type text,
      year int,
      metadata jsonb default '{}'::jsonb,
      created_at timestamptz default now()
    )
  `;

  await sql`
    alter table documents
    add column if not exists source_name text
  `;

  await sql`
    alter table documents
    add column if not exists source_type text
  `;

  await sql`
    alter table documents
    add column if not exists dataset_name text
  `;

  await sql`
    alter table documents
    add column if not exists title text
  `;

  await sql`
    alter table documents
    add column if not exists drug_name text
  `;

  await sql`
    alter table documents
    add column if not exists manufacturer text
  `;

  await sql`
    alter table documents
    add column if not exists year int
  `;

  await sql`
    alter table documents
    add column if not exists url text
  `;

  await sql`
    alter table documents
    add column if not exists metadata jsonb default '{}'::jsonb
  `;

  await sql`
    alter table document_chunks
    add column if not exists drug_name text
  `;

  await sql`
    alter table document_chunks
    add column if not exists manufacturer text
  `;

  await sql`
    alter table document_chunks
    add column if not exists source_type text
  `;

  await sql`
    alter table document_chunks
    add column if not exists year int
  `;

  await sql`
    alter table document_chunks
    add column if not exists metadata jsonb default '{}'::jsonb
  `;

  await sql`
    create index if not exists idx_documents_dataset_name
    on documents (dataset_name)
  `;

  await sql`
    create index if not exists idx_documents_source_type
    on documents (source_type)
  `;

  await sql`
    create index if not exists idx_documents_drug_name
    on documents (drug_name)
  `;

  await sql`
    create index if not exists idx_document_chunks_source_type
    on document_chunks (source_type)
  `;

  await sql`
    create index if not exists idx_document_chunks_drug_name
    on document_chunks (drug_name)
  `;

  await sql`
    create index if not exists idx_document_chunks_metadata_gin
    on document_chunks using gin (metadata)
  `;

  console.log("openFDA schema preparation complete.");
}

main().catch((error) => {
  console.error("Failed to prepare openFDA schema:", error);
  process.exit(1);
});