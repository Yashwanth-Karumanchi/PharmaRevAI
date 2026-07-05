import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

type OpenFdaLabelRecord = {
  id?: string;
  set_id?: string;
  spl_id?: string[];
  effective_time?: string;
  openfda?: {
    brand_name?: string[];
    generic_name?: string[];
    manufacturer_name?: string[];
    product_type?: string[];
    route?: string[];
    substance_name?: string[];
    pharm_class_epc?: string[];
    application_number?: string[];
  };
  indications_and_usage?: string[];
  purpose?: string[];
  boxed_warning?: string[];
  warnings?: string[];
  warnings_and_cautions?: string[];
  contraindications?: string[];
  adverse_reactions?: string[];
  dosage_and_administration?: string[];
  description?: string[];
  clinical_pharmacology?: string[];
  drug_interactions?: string[];
  use_in_specific_populations?: string[];
  pregnancy?: string[];
  pediatric_use?: string[];
  geriatric_use?: string[];
  overdosage?: string[];
  how_supplied?: string[];
};

type OpenFdaResponse = {
  results?: OpenFdaLabelRecord[];
  error?: {
    code?: string;
    message?: string;
  };
};

type DocumentInsertRow = {
  source_type: string;
  source_dataset: string;
  external_id: string;
  title: string;
  source_url: string;
  drug_name: string;
  brand_name: string;
  generic_name: string;
  manufacturer_name: string;
  metadata: unknown;
};

type InsertedDocument = {
  id: string;
  external_id: string;
};

type ChunkInsertRow = {
  document_id: string;
  source_type: string;
  chunk_text: string;
  section: string;
  chunk_index: number;
  drug_name: string;
  brand_name: string;
  generic_name: string;
  manufacturer_name: string;
  source_dataset: string;
  source_url: string;
  metadata: unknown;
};

const sourceType = "drug_label";
const sourceDataset = "openFDA Drug Label Dataset";
const baseUrl = "https://api.fda.gov/drug/label.json";

const targetDrugs = (
  process.env.OPENFDA_TARGET_DRUGS ||
  "Anoro Ellipta,Adempas,Arexvy,Trelegy Ellipta,Breo Ellipta,Advair Diskus,Spiriva,Symbicort,Eliquis,Januvia,Ozempic,Trulicity,Humira,Stelara,Dupixent,Keytruda,Ibrance,Farxiga,Jardiance"
)
  .split(",")
  .map((drug) => drug.trim())
  .filter(Boolean);

const labelsPerDrug = Number(process.env.OPENFDA_TARGET_LABELS_PER_DRUG || 3);
const requestDelayMs = Number(process.env.OPENFDA_REQUEST_DELAY_MS || 75);
const maxChunksPerDocument = Number(process.env.OPENFDA_MAX_CHUNKS_PER_DOCUMENT || 6);
const chunkSize = Number(process.env.OPENFDA_CHUNK_SIZE || 1200);
const chunkOverlap = Number(process.env.OPENFDA_CHUNK_OVERLAP || 120);

const sectionMap: Array<{
  key: keyof OpenFdaLabelRecord;
  label: string;
  priority: number;
}> = [
  { key: "indications_and_usage", label: "Indications and Usage", priority: 1 },
  { key: "purpose", label: "Purpose", priority: 2 },
  { key: "boxed_warning", label: "Boxed Warning", priority: 3 },
  { key: "warnings_and_cautions", label: "Warnings and Precautions", priority: 4 },
  { key: "warnings", label: "Warnings", priority: 5 },
  { key: "contraindications", label: "Contraindications", priority: 6 },
  { key: "adverse_reactions", label: "Adverse Reactions", priority: 7 },
  { key: "dosage_and_administration", label: "Dosage and Administration", priority: 8 },
  { key: "drug_interactions", label: "Drug Interactions", priority: 9 },
  { key: "use_in_specific_populations", label: "Use in Specific Populations", priority: 10 },
  { key: "clinical_pharmacology", label: "Clinical Pharmacology", priority: 11 },
  { key: "description", label: "Description", priority: 12 },
  { key: "overdosage", label: "Overdosage", priority: 13 },
  { key: "how_supplied", label: "How Supplied", priority: 14 },
];

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cleanText(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function first(value: string[] | undefined) {
  return value?.find((item) => item && item.trim())?.trim() || "";
}

function normalizeForExternalId(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function getBrand(record: OpenFdaLabelRecord, fallbackDrug = "") {
  return first(record.openfda?.brand_name) || fallbackDrug || "Unknown brand";
}

function getGeneric(record: OpenFdaLabelRecord) {
  return first(record.openfda?.generic_name) || "Unknown generic";
}

function getManufacturer(record: OpenFdaLabelRecord) {
  return first(record.openfda?.manufacturer_name) || "Unknown manufacturer";
}

function buildTitle(record: OpenFdaLabelRecord, fallbackDrug = "") {
  const brand = getBrand(record, fallbackDrug);
  const generic = getGeneric(record);
  const manufacturer = getManufacturer(record);

  return `openFDA label: ${brand} (${generic}) — ${manufacturer}`;
}

function getExternalId(record: OpenFdaLabelRecord, drug: string, fallbackIndex: number) {
  const baseId =
    record.set_id ||
    record.id ||
    first(record.spl_id) ||
    `${normalizeForExternalId(drug)}-${fallbackIndex}`;

  return `targeted-${normalizeForExternalId(drug)}-${baseId}`;
}

function splitIntoChunks(text: string) {
  const normalized = cleanText(text);

  if (!normalized) return [];
  if (normalized.length <= chunkSize) return [normalized];

  const chunks: string[] = [];
  let start = 0;

  while (start < normalized.length) {
    const end = Math.min(start + chunkSize, normalized.length);
    const chunk = normalized.slice(start, end).trim();

    if (chunk) chunks.push(chunk);
    if (end >= normalized.length) break;

    start = Math.max(0, end - chunkOverlap);
  }

  return chunks;
}

function getSectionText(record: OpenFdaLabelRecord, key: keyof OpenFdaLabelRecord) {
  const value = record[key];

  if (!Array.isArray(value)) {
    return "";
  }

  return cleanText(value.join(" "));
}

function buildSearchQueries(drug: string) {
  const tokens = drug
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);

  const firstToken = tokens[0] || drug;

  const queries = [
    `openfda.brand_name:"${drug}"`,
    `openfda.brand_name:${firstToken}`,
    tokens.map((token) => `openfda.brand_name:${token}`).join(" AND "),
    `"${drug}"`,
    tokens.join(" AND "),
  ];

  return Array.from(new Set(queries.filter(Boolean)));
}

function buildUrlFromSearch(search: string, useApiKey = true) {
  const params = new URLSearchParams();

  params.set("search", search);
  params.set("limit", String(labelsPerDrug));

  const apiKey = process.env.OPENFDA_API_KEY?.trim();

  if (useApiKey && apiKey) {
    params.set("api_key", apiKey);
  }

  return `${baseUrl}?${params.toString()}`;
}

async function fetchUrl(url: string) {
  const response = await fetch(url);

  if (response.status === 404) {
    return {
      ok: true,
      invalidApiKey: false,
      records: [] as OpenFdaLabelRecord[],
      errorText: "",
    };
  }

  if (response.ok) {
    const data = (await response.json()) as OpenFdaResponse;
    return {
      ok: true,
      invalidApiKey: false,
      records: data.results ?? [],
      errorText: "",
    };
  }

  const errorText = await response.text();
  const invalidApiKey =
    response.status === 403 && errorText.toLowerCase().includes("api_key_invalid");

  return {
    ok: false,
    invalidApiKey,
    records: [] as OpenFdaLabelRecord[],
    errorText: `HTTP ${response.status}: ${errorText}`,
  };
}

async function fetchDrugLabels(drug: string) {
  const searches = buildSearchQueries(drug);
  const byExternalKey = new Map<string, OpenFdaLabelRecord>();

  for (const search of searches) {
    const urlWithKey = buildUrlFromSearch(search, true);
    let result = await fetchUrl(urlWithKey);

    if (!result.ok && result.invalidApiKey) {
      console.warn(`openFDA API key invalid. Retrying ${drug} without api_key.`);
      result = await fetchUrl(buildUrlFromSearch(search, false));
    }

    if (!result.ok) {
      console.warn(`openFDA search failed for ${drug}: ${search}`);
      console.warn(result.errorText);
      continue;
    }

    for (const record of result.records) {
      const key = record.set_id || record.id || first(record.spl_id) || JSON.stringify(record).slice(0, 120);
      byExternalKey.set(key, record);
    }

    if (byExternalKey.size >= labelsPerDrug) {
      break;
    }

    if (requestDelayMs > 0) {
      await sleep(requestDelayMs);
    }
  }

  return Array.from(byExternalKey.values()).slice(0, labelsPerDrug);
}

async function ensureCompatibilityColumns() {
  const { sql } = await import("../lib/db/client");

  await sql`alter table documents add column if not exists drug_name text`;
  await sql`alter table documents add column if not exists brand_name text`;
  await sql`alter table documents add column if not exists generic_name text`;
  await sql`alter table documents add column if not exists manufacturer_name text`;

  await sql`alter table document_chunks add column if not exists drug_name text`;
  await sql`alter table document_chunks add column if not exists brand_name text`;
  await sql`alter table document_chunks add column if not exists generic_name text`;
  await sql`alter table document_chunks add column if not exists manufacturer_name text`;
  await sql`alter table document_chunks add column if not exists source_url text`;
  await sql`alter table document_chunks add column if not exists source_dataset text`;
}

function buildDocumentRow(
  record: OpenFdaLabelRecord,
  externalId: string,
  drug: string,
  sourceUrl: string
): DocumentInsertRow {
  const brand = getBrand(record, drug);
  const generic = getGeneric(record);
  const manufacturer = getManufacturer(record);

  return {
    source_type: sourceType,
    source_dataset: sourceDataset,
    external_id: externalId,
    title: buildTitle(record, drug),
    source_url: sourceUrl,
    drug_name: brand,
    brand_name: brand,
    generic_name: generic,
    manufacturer_name: manufacturer,
    metadata: {
      drugName: brand,
      brandName: brand,
      genericName: generic,
      manufacturerName: manufacturer,
      drug_name: brand,
      brand_name: brand,
      generic_name: generic,
      manufacturer_name: manufacturer,
      effectiveTime: record.effective_time || null,
      splId: record.spl_id || [],
      productType: record.openfda?.product_type || [],
      route: record.openfda?.route || [],
      substanceName: record.openfda?.substance_name || [],
      pharmClassEpc: record.openfda?.pharm_class_epc || [],
      applicationNumber: record.openfda?.application_number || [],
      source: "openFDA",
      ingestionMode: "targeted",
      targetDrug: drug,
    },
  };
}

function buildChunkRows(
  record: OpenFdaLabelRecord,
  documentId: string,
  drug: string,
  sourceUrl: string
) {
  const brand = getBrand(record, drug);
  const generic = getGeneric(record);
  const manufacturer = getManufacturer(record);
  const title = buildTitle(record, drug);

  const rows: ChunkInsertRow[] = [];
  let chunkIndex = 0;

  const sortedSections = [...sectionMap].sort((a, b) => a.priority - b.priority);

  for (const section of sortedSections) {
    const sectionText = getSectionText(record, section.key);

    if (!sectionText) {
      continue;
    }

    const chunks = splitIntoChunks(sectionText);

    for (const chunk of chunks) {
      if (rows.length >= maxChunksPerDocument) {
        return rows;
      }

      chunkIndex += 1;

      rows.push({
        document_id: documentId,
        source_type: sourceType,
        chunk_text: [
          `Source: ${sourceDataset}`,
          `Title: ${title}`,
          `Drug: ${brand}`,
          `Brand name: ${brand}`,
          `Generic name: ${generic}`,
          `Manufacturer: ${manufacturer}`,
          `Section: ${section.label}`,
          "",
          chunk,
        ].join("\n"),
        section: section.label,
        chunk_index: chunkIndex,
        drug_name: brand,
        brand_name: brand,
        generic_name: generic,
        manufacturer_name: manufacturer,
        source_dataset: sourceDataset,
        source_url: sourceUrl,
        metadata: {
          drugName: brand,
          brandName: brand,
          genericName: generic,
          manufacturerName: manufacturer,
          drug_name: brand,
          brand_name: brand,
          generic_name: generic,
          manufacturer_name: manufacturer,
          section: section.label,
          sectionKey: section.key,
          chunkIndex,
          effectiveTime: record.effective_time || null,
          source: "openFDA",
          ingestionMode: "targeted",
          targetDrug: drug,
        },
      });
    }
  }

  return rows;
}

async function upsertDocuments(rows: DocumentInsertRow[]) {
  if (rows.length === 0) {
    return [];
  }

  const { sql } = await import("../lib/db/client");

  return sql<InsertedDocument[]>`
    insert into documents ${sql(
      rows,
      "source_type",
      "source_dataset",
      "external_id",
      "title",
      "source_url",
      "drug_name",
      "brand_name",
      "generic_name",
      "manufacturer_name",
      "metadata"
    )}
    on conflict (source_type, external_id)
    do update set
      source_dataset = excluded.source_dataset,
      title = excluded.title,
      source_url = excluded.source_url,
      drug_name = excluded.drug_name,
      brand_name = excluded.brand_name,
      generic_name = excluded.generic_name,
      manufacturer_name = excluded.manufacturer_name,
      metadata = excluded.metadata,
      updated_at = now()
    returning id::text, external_id
  `;
}

async function deleteExistingChunks(documentIds: string[]) {
  if (documentIds.length === 0) {
    return;
  }

  const { sql } = await import("../lib/db/client");

  await sql`
    delete from document_chunks
    where document_id = any(${documentIds})
  `;
}

async function insertChunks(rows: ChunkInsertRow[]) {
  if (rows.length === 0) {
    return;
  }

  const { sql } = await import("../lib/db/client");

  await sql`
    insert into document_chunks ${sql(
      rows,
      "document_id",
      "source_type",
      "chunk_text",
      "section",
      "chunk_index",
      "drug_name",
      "brand_name",
      "generic_name",
      "manufacturer_name",
      "source_dataset",
      "source_url",
      "metadata"
    )}
  `;
}

async function ingestDrug(drug: string) {
  console.log("");
  console.log(`Fetching targeted openFDA labels for ${drug}`);

  const records = await fetchDrugLabels(drug);

  if (records.length === 0) {
    console.log(`No openFDA labels found for ${drug}`);
    return {
      drug,
      records: 0,
      documents: 0,
      chunks: 0,
    };
  }

  const sourceUrl = buildUrlFromSearch(`openfda.brand_name:"${drug}"`, false);

  const documentRows = records.map((record, index) => {
    const externalId = getExternalId(record, drug, index);
    return buildDocumentRow(record, externalId, drug, sourceUrl);
  });

  const insertedDocuments = await upsertDocuments(documentRows);
  await deleteExistingChunks(insertedDocuments.map((document) => document.id));

  const documentIdsByExternalId = new Map(
    insertedDocuments.map((document) => [document.external_id, document.id])
  );

  const chunkRows: ChunkInsertRow[] = [];

  records.forEach((record, index) => {
    const externalId = getExternalId(record, drug, index);
    const documentId = documentIdsByExternalId.get(externalId);

    if (!documentId) {
      return;
    }

    chunkRows.push(...buildChunkRows(record, documentId, drug, sourceUrl));
  });

  await insertChunks(chunkRows);

  console.log({
    drug,
    records: records.length,
    documents: insertedDocuments.length,
    chunks: chunkRows.length,
  });

  return {
    drug,
    records: records.length,
    documents: insertedDocuments.length,
    chunks: chunkRows.length,
  };
}

async function countTargetMatches() {
  const { sql } = await import("../lib/db/client");

  return sql`
    select
      count(*)::text as total_targeted_chunks,
      count(*) filter (
        where drug_name ilike '%anoro%'
          or brand_name ilike '%anoro%'
          or chunk_text ilike '%anoro%'
      )::text as anoro_chunks,
      count(*) filter (
        where embedding is not null
      )::text as already_embedded_targeted_chunks
    from document_chunks
    where source_type = 'drug_label'
      and (
        metadata->>'ingestionMode' = 'targeted'
        or source_url ilike '%openfda%'
      )
  `;
}

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is missing. Check .env.local.");
  }

  console.log("Starting targeted openFDA label ingestion using old app data contract...");
  console.log({
    targetDrugCount: targetDrugs.length,
    targetDrugs,
    labelsPerDrug,
    requestDelayMs,
    maxChunksPerDocument,
    chunkSize,
    chunkOverlap,
    hasOpenFdaApiKey: Boolean(process.env.OPENFDA_API_KEY?.trim()),
  });

  await ensureCompatibilityColumns();

  let totalRecords = 0;
  let totalDocuments = 0;
  let totalChunks = 0;

  for (const drug of targetDrugs) {
    const result = await ingestDrug(drug);

    totalRecords += result.records;
    totalDocuments += result.documents;
    totalChunks += result.chunks;

    if (requestDelayMs > 0) {
      await sleep(requestDelayMs);
    }
  }

  console.log("");
  console.log("Targeted openFDA label ingestion complete.");
  console.log({
    totalRecords,
    totalDocuments,
    totalChunks,
  });

  console.log("");
  console.log("Targeted chunk summary:");
  console.table(await countTargetMatches());
}

main().catch((error) => {
  console.error("Targeted openFDA ingestion failed:", error);
  process.exit(1);
});