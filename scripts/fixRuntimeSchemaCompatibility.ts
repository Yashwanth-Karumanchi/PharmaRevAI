import dotenv from "dotenv";

dotenv.config({ path: ".env.local", override: true });

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is missing.");
  }

  const { sql } = await import("../lib/db/client");

  console.log("Fixing runtime schema compatibility aliases...");

  await sql`
    alter table documents
    add column if not exists dataset_name text
  `;

  await sql`
    alter table documents
    add column if not exists source_name text
  `;

  await sql`
    alter table document_chunks
    add column if not exists dataset_name text
  `;

  await sql`
    alter table document_chunks
    add column if not exists source_name text
  `;

  await sql`
    update documents
    set dataset_name = coalesce(
      nullif(dataset_name, ''),
      nullif(source_dataset, ''),
      nullif(metadata->>'sourceDataset', ''),
      nullif(metadata->>'datasetName', ''),
      nullif(metadata->>'dataset', ''),
      nullif(source_type, ''),
      'Unknown public dataset'
    )
    where dataset_name is null
       or dataset_name = ''
  `;

  await sql`
    update documents
    set source_name = coalesce(
      nullif(source_name, ''),
      nullif(source_dataset, ''),
      nullif(dataset_name, ''),
      nullif(metadata->>'sourceName', ''),
      nullif(metadata->>'sourceDataset', ''),
      nullif(metadata->>'datasetName', ''),
      nullif(source_type, ''),
      'Unknown public source'
    )
    where source_name is null
       or source_name = ''
  `;

  await sql`
    update document_chunks
    set dataset_name = coalesce(
      nullif(dataset_name, ''),
      nullif(source_dataset, ''),
      nullif(metadata->>'sourceDataset', ''),
      nullif(metadata->>'datasetName', ''),
      nullif(metadata->>'dataset', ''),
      nullif(source_type, ''),
      'Unknown public dataset'
    )
    where dataset_name is null
       or dataset_name = ''
  `;

  await sql`
    update document_chunks
    set source_name = coalesce(
      nullif(source_name, ''),
      nullif(source_dataset, ''),
      nullif(dataset_name, ''),
      nullif(metadata->>'sourceName', ''),
      nullif(metadata->>'sourceDataset', ''),
      nullif(metadata->>'datasetName', ''),
      nullif(source_type, ''),
      'Unknown public source'
    )
    where source_name is null
       or source_name = ''
  `;

  await sql`
    create index if not exists idx_documents_dataset_name
    on documents (dataset_name)
  `;

  await sql`
    create index if not exists idx_documents_source_name
    on documents (source_name)
  `;

  await sql`
    create index if not exists idx_document_chunks_dataset_name
    on document_chunks (dataset_name)
  `;

  await sql`
    create index if not exists idx_document_chunks_source_name
    on document_chunks (source_name)
  `;

  const docs = await sql`
    select
      count(*)::int as total_documents,
      count(dataset_name)::int as documents_with_dataset_name,
      count(source_name)::int as documents_with_source_name
    from documents
  `;

  const chunks = await sql`
    select
      count(*)::int as total_chunks,
      count(dataset_name)::int as chunks_with_dataset_name,
      count(source_name)::int as chunks_with_source_name
    from document_chunks
  `;

  console.log("documents:");
  console.table(docs);

  console.log("document_chunks:");
  console.table(chunks);

  console.log("Runtime schema compatibility aliases fixed.");
}

main().catch((error) => {
  console.error("Runtime schema compatibility fix failed:");
  console.error(error);
  process.exit(1);
});