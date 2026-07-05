import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

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

async function databaseSizeMb() {
  const { sql } = await import("../lib/db/client");

  const rows = await sql<{ size_mb: string }[]>`
    select round(pg_database_size(current_database()) / 1024.0 / 1024.0, 2)::text as size_mb
  `;

  return Number(rows[0]?.size_mb || 0);
}

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is missing. Check .env.local.");
  }

  const { sql } = await import("../lib/db/client");

  console.log("Ensuring old drug-label data contract compatibility...");
  console.log({
    databaseSizeBeforeMb: await databaseSizeMb(),
  });

  const hasDocuments = await tableExists("documents");
  const hasDocumentChunks = await tableExists("document_chunks");

  if (!hasDocuments || !hasDocumentChunks) {
    console.log("documents/document_chunks do not exist yet. Skipping compatibility sync.");
    return;
  }

  console.log("Adding old-compatible columns to documents...");

  await sql`alter table documents add column if not exists drug_name text`;
  await sql`alter table documents add column if not exists brand_name text`;
  await sql`alter table documents add column if not exists generic_name text`;
  await sql`alter table documents add column if not exists manufacturer_name text`;

  console.log("Adding old-compatible columns to document_chunks...");

  await sql`alter table document_chunks add column if not exists drug_name text`;
  await sql`alter table document_chunks add column if not exists brand_name text`;
  await sql`alter table document_chunks add column if not exists generic_name text`;
  await sql`alter table document_chunks add column if not exists manufacturer_name text`;
  await sql`alter table document_chunks add column if not exists source_url text`;
  await sql`alter table document_chunks add column if not exists source_dataset text`;

  console.log("Backfilling documents old-compatible fields from metadata/title...");

  await sql`
    update documents
    set
      brand_name = coalesce(
        nullif(brand_name, ''),
        nullif(metadata->>'brandName', ''),
        nullif(metadata->>'drugName', ''),
        nullif(metadata->>'brand_name', ''),
        nullif(metadata->>'drug_name', ''),
        nullif(regexp_replace(coalesce(title, ''), '^openFDA label: ([^(—]+).*$', '\\1'), '')
      ),
      drug_name = coalesce(
        nullif(drug_name, ''),
        nullif(metadata->>'drugName', ''),
        nullif(metadata->>'brandName', ''),
        nullif(metadata->>'drug_name', ''),
        nullif(metadata->>'brand_name', ''),
        nullif(regexp_replace(coalesce(title, ''), '^openFDA label: ([^(—]+).*$', '\\1'), '')
      ),
      generic_name = coalesce(
        nullif(generic_name, ''),
        nullif(metadata->>'genericName', ''),
        nullif(metadata->>'generic_name', '')
      ),
      manufacturer_name = coalesce(
        nullif(manufacturer_name, ''),
        nullif(metadata->>'manufacturerName', ''),
        nullif(metadata->>'manufacturer_name', '')
      )
    where source_type = 'drug_label'
  `;

  console.log("Normalizing documents metadata to include both camelCase and snake_case keys...");

  await sql`
    update documents
    set metadata =
      coalesce(metadata, '{}'::jsonb)
      || jsonb_strip_nulls(
        jsonb_build_object(
          'drugName', nullif(drug_name, ''),
          'brandName', nullif(brand_name, ''),
          'genericName', nullif(generic_name, ''),
          'manufacturerName', nullif(manufacturer_name, ''),
          'drug_name', nullif(drug_name, ''),
          'brand_name', nullif(brand_name, ''),
          'generic_name', nullif(generic_name, ''),
          'manufacturer_name', nullif(manufacturer_name, '')
        )
      )
    where source_type = 'drug_label'
  `;

  console.log("Backfilling document_chunks old-compatible fields from chunk/doc metadata...");

  await sql`
    update document_chunks dc
    set
      brand_name = coalesce(
        nullif(dc.brand_name, ''),
        nullif(dc.metadata->>'brandName', ''),
        nullif(dc.metadata->>'drugName', ''),
        nullif(dc.metadata->>'brand_name', ''),
        nullif(dc.metadata->>'drug_name', ''),
        nullif(d.brand_name, ''),
        nullif(d.drug_name, ''),
        nullif(d.metadata->>'brandName', ''),
        nullif(d.metadata->>'drugName', '')
      ),
      drug_name = coalesce(
        nullif(dc.drug_name, ''),
        nullif(dc.metadata->>'drugName', ''),
        nullif(dc.metadata->>'brandName', ''),
        nullif(dc.metadata->>'drug_name', ''),
        nullif(dc.metadata->>'brand_name', ''),
        nullif(d.drug_name, ''),
        nullif(d.brand_name, ''),
        nullif(d.metadata->>'drugName', ''),
        nullif(d.metadata->>'brandName', '')
      ),
      generic_name = coalesce(
        nullif(dc.generic_name, ''),
        nullif(dc.metadata->>'genericName', ''),
        nullif(dc.metadata->>'generic_name', ''),
        nullif(d.generic_name, ''),
        nullif(d.metadata->>'genericName', ''),
        nullif(d.metadata->>'generic_name', '')
      ),
      manufacturer_name = coalesce(
        nullif(dc.manufacturer_name, ''),
        nullif(dc.metadata->>'manufacturerName', ''),
        nullif(dc.metadata->>'manufacturer_name', ''),
        nullif(d.manufacturer_name, ''),
        nullif(d.metadata->>'manufacturerName', ''),
        nullif(d.metadata->>'manufacturer_name', '')
      ),
      source_url = coalesce(
        nullif(dc.source_url, ''),
        nullif(d.source_url, '')
      ),
      source_dataset = coalesce(
        nullif(dc.source_dataset, ''),
        nullif(d.source_dataset, '')
      )
    from documents d
    where dc.document_id = d.id
      and dc.source_type = 'drug_label'
  `;

  console.log("Normalizing document_chunks metadata to include both camelCase and snake_case keys...");

  await sql`
    update document_chunks
    set metadata =
      coalesce(metadata, '{}'::jsonb)
      || jsonb_strip_nulls(
        jsonb_build_object(
          'drugName', nullif(drug_name, ''),
          'brandName', nullif(brand_name, ''),
          'genericName', nullif(generic_name, ''),
          'manufacturerName', nullif(manufacturer_name, ''),
          'drug_name', nullif(drug_name, ''),
          'brand_name', nullif(brand_name, ''),
          'generic_name', nullif(generic_name, ''),
          'manufacturer_name', nullif(manufacturer_name, '')
        )
      )
    where source_type = 'drug_label'
  `;

  console.log("Creating compact compatibility indexes...");

  await sql`
    create index if not exists idx_document_chunks_drug_name_lower
    on document_chunks (lower(drug_name))
    where source_type = 'drug_label'
  `;

  await sql`
    create index if not exists idx_document_chunks_brand_name_lower
    on document_chunks (lower(brand_name))
    where source_type = 'drug_label'
  `;

  await sql`
    create index if not exists idx_document_chunks_generic_name_lower
    on document_chunks (lower(generic_name))
    where source_type = 'drug_label'
  `;

  await sql`
    create index if not exists idx_documents_drug_name_lower
    on documents (lower(drug_name))
    where source_type = 'drug_label'
  `;

  await sql`analyze documents`;
  await sql`analyze document_chunks`;

  const summary = await sql`
    select
      count(*)::text as total_chunks,
      count(*) filter (where source_type = 'drug_label')::text as drug_label_chunks,
      count(*) filter (where source_type = 'drug_label' and drug_name is not null and drug_name <> '')::text as chunks_with_drug_name,
      count(*) filter (where source_type = 'drug_label' and embedding is not null)::text as embedded_drug_label_chunks,
      count(*) filter (
        where source_type = 'drug_label'
          and (
            drug_name ilike '%anoro%'
            or brand_name ilike '%anoro%'
            or chunk_text ilike '%anoro%'
          )
      )::text as anoro_matching_chunks
    from document_chunks
  `;

  const samples = await sql`
    select
      dc.id::text,
      dc.drug_name,
      dc.brand_name,
      dc.generic_name,
      dc.section,
      dc.embedding is not null as has_embedding,
      left(dc.chunk_text, 120) as preview
    from document_chunks dc
    where dc.source_type = 'drug_label'
    order by dc.created_at desc
    limit 8
  `;

  console.log("Compatibility summary:");
  console.table(summary);

  console.log("Sample drug label chunks:");
  console.table(samples);

  console.log({
    databaseSizeAfterMb: await databaseSizeMb(),
  });

  console.log("Old drug-label data contract compatibility complete.");
}

main().catch((error) => {
  console.error("Drug-label compatibility sync failed:", error);
  process.exit(1);
});