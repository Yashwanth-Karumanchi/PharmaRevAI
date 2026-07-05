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
  meta?: {
    results?: {
      total?: number;
      skip?: number;
      limit?: number;
    };
  };
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
  metadata: unknown;
};

const sourceType = "drug_label";
const sourceDataset = "openFDA Drug Label Dataset";
const baseUrl = "https://api.fda.gov/drug/label.json";

const pageLimit = Number(process.env.OPENFDA_PAGE_LIMIT || 1000);
const maxRecords = Number(process.env.OPENFDA_MAX_RECORDS || 25000);
const requestDelayMs = Number(process.env.OPENFDA_REQUEST_DELAY_MS || 75);
const maxChunksPerDocument = Number(process.env.OPENFDA_MAX_CHUNKS_PER_DOCUMENT || 18);
const chunkSize = Number(process.env.OPENFDA_CHUNK_SIZE || 1600);
const chunkOverlap = Number(process.env.OPENFDA_CHUNK_OVERLAP || 180);

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
  { key: "pregnancy", label: "Pregnancy", priority: 11 },
  { key: "pediatric_use", label: "Pediatric Use", priority: 12 },
  { key: "geriatric_use", label: "Geriatric Use", priority: 13 },
  { key: "clinical_pharmacology", label: "Clinical Pharmacology", priority: 14 },
  { key: "description", label: "Description", priority: 15 },
  { key: "overdosage", label: "Overdosage", priority: 16 },
  { key: "how_supplied", label: "How Supplied", priority: 17 },
];

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cleanText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function first(value: string[] | undefined) {
  return value?.find((item) => item && item.trim())?.trim() || "";
}

function getExternalId(record: OpenFdaLabelRecord, fallbackIndex: number) {
  return (
    record.set_id ||
    record.id ||
    first(record.spl_id) ||
    `openfda-label-${fallbackIndex}`
  );
}

function getBrand(record: OpenFdaLabelRecord) {
  return first(record.openfda?.brand_name) || "Unknown brand";
}

function getGeneric(record: OpenFdaLabelRecord) {
  return first(record.openfda?.generic_name) || "Unknown generic";
}

function getManufacturer(record: OpenFdaLabelRecord) {
  return first(record.openfda?.manufacturer_name) || "Unknown manufacturer";
}

function buildTitle(record: OpenFdaLabelRecord) {
  const brand = getBrand(record);
  const generic = getGeneric(record);
  const manufacturer = getManufacturer(record);

  return `openFDA label: ${brand} (${generic}) — ${manufacturer}`;
}

function buildSourceUrl(record: OpenFdaLabelRecord) {
  const setId = record.set_id;

  if (setId) {
    return `https://api.fda.gov/drug/label.json?search=set_id:${encodeURIComponent(setId)}`;
  }

  return "https://api.fda.gov/drug/label.json";
}

function getSectionText(record: OpenFdaLabelRecord, key: keyof OpenFdaLabelRecord) {
  const value = record[key];

  if (!Array.isArray(value)) {
    return "";
  }

  return cleanText(value.join(" "));
}

function splitIntoChunks(text: string) {
  const normalized = cleanText(text);

  if (!normalized) {
    return [];
  }

  if (normalized.length <= chunkSize) {
    return [normalized];
  }

  const chunks: string[] = [];
  let start = 0;

  while (start < normalized.length) {
    const end = Math.min(start + chunkSize, normalized.length);
    const chunk = normalized.slice(start, end).trim();

    if (chunk) {
      chunks.push(chunk);
    }

    if (end >= normalized.length) {
      break;
    }

    start = Math.max(0, end - chunkOverlap);
  }

  return chunks;
}

function buildDocumentRow(record: OpenFdaLabelRecord, externalId: string): DocumentInsertRow {
  const brand = getBrand(record);
  const generic = getGeneric(record);
  const manufacturer = getManufacturer(record);

  return {
    source_type: sourceType,
    source_dataset: sourceDataset,
    external_id: externalId,
    title: buildTitle(record),
    source_url: buildSourceUrl(record),
    metadata: {
      drugName: brand,
      brandName: brand,
      genericName: generic,
      manufacturerName: manufacturer,
      effectiveTime: record.effective_time || null,
      splId: record.spl_id || [],
      productType: record.openfda?.product_type || [],
      route: record.openfda?.route || [],
      substanceName: record.openfda?.substance_name || [],
      pharmClassEpc: record.openfda?.pharm_class_epc || [],
      applicationNumber: record.openfda?.application_number || [],
      source: "openFDA",
    },
  };
}

function buildChunkRows(record: OpenFdaLabelRecord, documentId: string) {
  const brand = getBrand(record);
  const generic = getGeneric(record);
  const manufacturer = getManufacturer(record);

  const rows: ChunkInsertRow[] = [];
  let chunkIndex = 0;

  for (const section of sectionMap.sort((a, b) => a.priority - b.priority)) {
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
        chunk_text: `Source: ${sourceDataset}\nTitle: ${buildTitle(record)}\nDrug: ${brand}\nGeneric name: ${generic}\nManufacturer: ${manufacturer}\nSection: ${section.label}\n\n${chunk}`,
        section: section.label,
        chunk_index: chunkIndex,
        metadata: {
          drugName: brand,
          brandName: brand,
          genericName: generic,
          manufacturerName: manufacturer,
          section: section.label,
          sectionKey: section.key,
          chunkIndex,
          effectiveTime: record.effective_time || null,
          source: "openFDA",
        },
      });
    }
  }

  return rows;
}

function buildOpenFdaUrl(skip: number, useApiKey = true) {
  const params = new URLSearchParams();
  params.set("limit", String(pageLimit));
  params.set("skip", String(skip));

  const apiKey = process.env.OPENFDA_API_KEY?.trim();

  if (useApiKey && apiKey) {
    params.set("api_key", apiKey);
  }

  return `${baseUrl}?${params.toString()}`;
}

async function fetchOpenFdaPage(skip: number) {
  const urlWithKey = buildOpenFdaUrl(skip, true);
  const response = await fetch(urlWithKey);

  if (response.ok) {
    const data = (await response.json()) as OpenFdaResponse;

    if (data.error?.message) {
      throw new Error(data.error.message);
    }

    return data;
  }

  const errorText = await response.text();

  const hasInvalidApiKey =
    response.status === 403 &&
    errorText.toLowerCase().includes("api_key_invalid");

  if (hasInvalidApiKey) {
    console.warn("openFDA API key is invalid. Retrying this request without api_key.");

    const retryUrl = buildOpenFdaUrl(skip, false);
    const retryResponse = await fetch(retryUrl);

    if (!retryResponse.ok) {
      const retryErrorText = await retryResponse.text();
      throw new Error(
        `openFDA retry without api_key failed HTTP ${retryResponse.status}: ${retryErrorText}`
      );
    }

    const retryData = (await retryResponse.json()) as OpenFdaResponse;

    if (retryData.error?.message) {
      throw new Error(retryData.error.message);
    }

    return retryData;
  }

  throw new Error(`openFDA request failed HTTP ${response.status}: ${errorText}`);
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
      "metadata"
    )}
    on conflict (source_type, external_id)
    do update set
      source_dataset = excluded.source_dataset,
      title = excluded.title,
      source_url = excluded.source_url,
      metadata = excluded.metadata,
      updated_at = now()
    returning id, external_id
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
      "metadata"
    )}
  `;
}

async function ingestPage(records: OpenFdaLabelRecord[], globalOffset: number) {
  const documentRows = records.map((record, index) => {
    const externalId = getExternalId(record, globalOffset + index);
    return buildDocumentRow(record, externalId);
  });

  const insertedDocuments = await upsertDocuments(documentRows);
  const documentIdsByExternalId = new Map(
    insertedDocuments.map((document) => [document.external_id, document.id])
  );

  await deleteExistingChunks(insertedDocuments.map((document) => document.id));

  const chunkRows: ChunkInsertRow[] = [];

  records.forEach((record, index) => {
    const externalId = getExternalId(record, globalOffset + index);
    const documentId = documentIdsByExternalId.get(externalId);

    if (!documentId) {
      return;
    }

    chunkRows.push(...buildChunkRows(record, documentId));
  });

  await insertChunks(chunkRows);

  return {
    documents: insertedDocuments.length,
    chunks: chunkRows.length,
  };
}

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is missing. Check .env.local.");
  }

  console.log("Starting wide openFDA label ingestion...");
  console.log({
    pageLimit,
    maxRecords,
    requestDelayMs,
    maxChunksPerDocument,
    chunkSize,
    chunkOverlap,
    hasOpenFdaApiKey: Boolean(process.env.OPENFDA_API_KEY),
  });

  let skip = 0;
  let totalSeen = 0;
  let totalDocuments = 0;
  let totalChunks = 0;
  let totalAvailable: number | null = null;

  while (totalSeen < maxRecords && skip <= 25000) {
    console.log("");
    console.log(`Fetching openFDA labels skip=${skip}, limit=${pageLimit}`);

    const data = await fetchOpenFdaPage(skip);
    const records = data.results ?? [];

    if (totalAvailable === null) {
      totalAvailable = data.meta?.results?.total ?? null;
    }

    if (records.length === 0) {
      console.log("No more openFDA label records returned.");
      break;
    }

    const remaining = maxRecords - totalSeen;
    const selectedRecords = records.slice(0, remaining);

    const pageResult = await ingestPage(selectedRecords, totalSeen);

    totalSeen += selectedRecords.length;
    totalDocuments += pageResult.documents;
    totalChunks += pageResult.chunks;

    console.log({
      totalAvailable,
      recordsThisPage: selectedRecords.length,
      documentsThisPage: pageResult.documents,
      chunksThisPage: pageResult.chunks,
      totalSeen,
      totalDocuments,
      totalChunks,
    });

    if (selectedRecords.length < pageLimit) {
      break;
    }

    skip += pageLimit;

    if (requestDelayMs > 0) {
      await sleep(requestDelayMs);
    }
  }

  console.log("");
  console.log("Wide openFDA label ingestion complete.");
  console.log({
    totalAvailable,
    totalSeen,
    totalDocuments,
    totalChunks,
  });
}

main().catch((error) => {
  console.error("Wide openFDA ingestion failed:", error);
  process.exit(1);
});