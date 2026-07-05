import dotenv from "dotenv";
import crypto from "crypto";
import { Readable } from "stream";
import { parse } from "csv-parse";

dotenv.config({ path: ".env.local" });

type CsvRecord = Record<string, string>;

type InsertRow = {
  row_hash: string;
  year: number;
  npi: string | null;
  provider_name: string | null;
  provider_city: string | null;
  provider_state: string | null;
  provider_specialty: string | null;
  brand_name: string | null;
  generic_name: string | null;
  total_claim_count: number | null;
  total_30day_fills: number | null;
  total_drug_cost: number | null;
  beneficiary_count: number | null;
  source_dataset: string;
  source_url: string;
  metadata: unknown;
};

type DrugSeed = {
  drug_name: string;
};

const datasetYear = Number(process.env.CMS_PRESCRIBERS_YEAR || 2024);

const csvUrl =
  process.env.CMS_PRESCRIBERS_CSV_URL ||
  "https://data.cms.gov/sites/default/files/2026-05/0ae165f4-eb44-495d-8cac-67f4571b6b83/MUP_DPR_RY26_P04_V10_DY24_NPIBN.csv";

const maxDrugs = Number(process.env.CMS_PRESCRIBERS_MAX_DRUGS || 300);
const maxRowsPerDrug = Number(process.env.CMS_PRESCRIBERS_MAX_ROWS_PER_DRUG || 3000);
const maxTotalRows = Number(process.env.CMS_PRESCRIBERS_MAX_TOTAL_ROWS || 900000);
const maxScannedRows = Number(process.env.CMS_PRESCRIBERS_MAX_SCANNED_ROWS || 12000000);
const batchSize = Number(process.env.CMS_PRESCRIBERS_BATCH_SIZE || 7500);
const insertColumnCount = 16;
const maxPostgresParameters = 30000;
const effectiveInsertBatchSize = Math.max(
  1,
  Math.min(batchSize, Math.floor(maxPostgresParameters / insertColumnCount))
);

function chunkRows<T>(rows: T[], size: number) {
  const chunks: T[][] = [];

  for (let index = 0; index < rows.length; index += size) {
    chunks.push(rows.slice(index, index + size));
  }

  return chunks;
}
const useTargetDrugFilter = process.env.CMS_PRESCRIBERS_USE_TARGET_DRUG_FILTER !== "false";

const sourceDataset = "CMS Medicare Part D Prescribers by Provider and Drug";

function normalize(value: string | null | undefined) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeKey(value: string | null | undefined) {
  return normalize(value).toLowerCase();
}

function numberOrNull(value: string | null | undefined) {
  const cleaned = normalize(value).replace(/[$,]/g, "");

  if (!cleaned) {
    return null;
  }

  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function textOrNull(value: string | null | undefined) {
  const cleaned = normalize(value);
  return cleaned ? cleaned : null;
}

function getField(record: CsvRecord, names: string[]) {
  for (const name of names) {
    if (record[name] !== undefined) {
      return record[name];
    }
  }

  const normalizedMap = new Map(
    Object.entries(record).map(([key, value]) => [
      key.toLowerCase().replace(/[^a-z0-9]/g, ""),
      value,
    ])
  );

  for (const name of names) {
    const value = normalizedMap.get(name.toLowerCase().replace(/[^a-z0-9]/g, ""));

    if (value !== undefined) {
      return value;
    }
  }

  return "";
}

function hashRow(parts: Array<string | number | null>) {
  return crypto
    .createHash("sha256")
    .update(parts.map((part) => String(part ?? "")).join("|"))
    .digest("hex");
}

function buildProviderName(record: CsvRecord) {
  const firstName = normalize(getField(record, ["Prscrbr_First_Name", "Prscrbr First Name"]));
  const lastName = normalize(getField(record, ["Prscrbr_Last_Org_Name", "Prscrbr Last Org Name"]));

  if (firstName && lastName) {
    return `${firstName} ${lastName}`;
  }

  return lastName || firstName || null;
}

function mapRecordToInsertRow(record: CsvRecord): InsertRow {
  const npi = textOrNull(getField(record, ["Prscrbr_NPI", "Prscrbr NPI", "NPI"]));
  const providerName = buildProviderName(record);
  const providerCity = textOrNull(getField(record, ["Prscrbr_City", "Prscrbr City"]));
  const providerState = textOrNull(
    getField(record, ["Prscrbr_State_Abrvtn", "Prscrbr State Abrvtn", "Prscrbr_State"])
  );
  const providerSpecialty = textOrNull(getField(record, ["Prscrbr_Type", "Prscrbr Type"]));
  const brandName = textOrNull(getField(record, ["Brnd_Name", "Brnd Name", "Brand Name"]));
  const genericName = textOrNull(getField(record, ["Gnrc_Name", "Gnrc Name", "Generic Name"]));

  const totalClaimCount = numberOrNull(getField(record, ["Tot_Clms", "Tot Clms", "Total Claims"]));
  const total30DayFills = numberOrNull(
    getField(record, ["Tot_30day_Fills", "Tot 30day Fills", "Total 30 Day Fills"])
  );
  const totalDrugCost = numberOrNull(
    getField(record, ["Tot_Drug_Cst", "Tot Drug Cst", "Total Drug Cost"])
  );
  const beneficiaryCount = numberOrNull(getField(record, ["Tot_Benes", "Tot Benes"]));

  const rowHash = hashRow([
    datasetYear,
    npi,
    providerName,
    providerCity,
    providerState,
    providerSpecialty,
    brandName,
    genericName,
    totalClaimCount,
    total30DayFills,
    totalDrugCost,
    beneficiaryCount,
  ]);

  return {
    row_hash: rowHash,
    year: datasetYear,
    npi,
    provider_name: providerName,
    provider_city: providerCity,
    provider_state: providerState,
    provider_specialty: providerSpecialty,
    brand_name: brandName,
    generic_name: genericName,
    total_claim_count: totalClaimCount,
    total_30day_fills: total30DayFills,
    total_drug_cost: totalDrugCost,
    beneficiary_count: beneficiaryCount,
    source_dataset: sourceDataset,
    source_url: csvUrl,
    metadata: {
      ingestionMode: "csv_fast",
      sourceYear: datasetYear,
    },
  };
}

function getExtraDrugNames() {
  return (process.env.CMS_PRESCRIBERS_EXTRA_DRUGS || "")
    .split(",")
    .map((value) => normalize(value))
    .filter(Boolean);
}

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

async function loadTargetDrugNames() {
  const { sql } = await import("../lib/db/client");
  const names: string[] = [];

  if (await tableExists("cms_part_d_spending")) {
    const rows = await sql<DrugSeed[]>`
      select brand_name as drug_name
      from cms_part_d_spending
      where brand_name is not null
        and lower(coalesce(manufacturer, '')) <> 'overall'
      group by brand_name
      order by max(total_spending) desc nulls last
      limit ${maxDrugs}
    `;

    names.push(...rows.map((row) => row.drug_name));
  }

  names.push(...getExtraDrugNames());

  return Array.from(new Set(names.map((name) => normalizeKey(name)).filter(Boolean))).slice(0, maxDrugs);
}

function shouldKeepRow({
  row,
  targetDrugSet,
  rowsByDrug,
}: {
  row: InsertRow;
  targetDrugSet: Set<string>;
  rowsByDrug: Map<string, number>;
}) {
  if (!useTargetDrugFilter) {
    return true;
  }

  const brandKey = normalizeKey(row.brand_name);
  const genericKey = normalizeKey(row.generic_name);
  const matchedDrug = targetDrugSet.has(brandKey)
    ? brandKey
    : targetDrugSet.has(genericKey)
      ? genericKey
      : "";

  if (!matchedDrug) {
    return false;
  }

  const currentCount = rowsByDrug.get(matchedDrug) || 0;

  if (currentCount >= maxRowsPerDrug) {
    return false;
  }

  rowsByDrug.set(matchedDrug, currentCount + 1);
  return true;
}

function allTargetDrugsFilled(targetDrugSet: Set<string>, rowsByDrug: Map<string, number>) {
  if (!useTargetDrugFilter || targetDrugSet.size === 0) {
    return false;
  }

  for (const drug of targetDrugSet) {
    if ((rowsByDrug.get(drug) || 0) < maxRowsPerDrug) {
      return false;
    }
  }

  return true;
}

async function insertBatch(rows: InsertRow[]) {
  if (rows.length === 0) {
    return;
  }

  const { sql } = await import("../lib/db/client");

  for (const chunk of chunkRows(rows, effectiveInsertBatchSize)) {
    await sql`
      insert into cms_part_d_prescribers ${sql(
        chunk,
        "row_hash",
        "year",
        "npi",
        "provider_name",
        "provider_city",
        "provider_state",
        "provider_specialty",
        "brand_name",
        "generic_name",
        "total_claim_count",
        "total_30day_fills",
        "total_drug_cost",
        "beneficiary_count",
        "source_dataset",
        "source_url",
        "metadata"
      )}
      on conflict (row_hash) do nothing
    `;
  }
}

async function getCsvStream() {
  console.log("Opening CMS Prescribers CSV stream...");
  console.log({ csvUrl });

  const response = await fetch(csvUrl);

  if (!response.ok || !response.body) {
    const text = await response.text().catch(() => "");
    throw new Error(`Failed to fetch CSV. HTTP ${response.status}: ${text}`);
  }

  return Readable.fromWeb(response.body as never);
}

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is missing. Check .env.local.");
  }

  console.log("Starting FAST CMS Part D Prescribers CSV ingestion...");
  console.log({
    datasetYear,
    maxDrugs,
    maxRowsPerDrug,
    maxTotalRows,
    maxScannedRows,
    batchSize,
    effectiveInsertBatchSize,
    useTargetDrugFilter,
  });

  const targetDrugNames = await loadTargetDrugNames();
  const targetDrugSet = new Set(targetDrugNames);

  console.log({
    targetDrugCount: targetDrugSet.size,
    targetDrugSample: Array.from(targetDrugSet).slice(0, 30),
  });

  if (useTargetDrugFilter && targetDrugSet.size === 0) {
    throw new Error(
      "No target drugs found. Run CMS Part D Spending ingestion first or set CMS_PRESCRIBERS_USE_TARGET_DRUG_FILTER=false."
    );
  }

  const stream = await getCsvStream();
  const parser = stream.pipe(
    parse({
      columns: true,
      bom: true,
      skip_empty_lines: true,
      relax_column_count: true,
      relax_quotes: true,
      trim: true,
    })
  );

  const rowsByDrug = new Map<string, number>();
  let batch: InsertRow[] = [];
  let scannedRows = 0;
  let keptRows = 0;
  let insertedRows = 0;
  let lastLogAt = Date.now();

  for await (const record of parser as AsyncIterable<CsvRecord>) {
    scannedRows += 1;

    if (scannedRows > maxScannedRows) {
      console.log("Reached CMS_PRESCRIBERS_MAX_SCANNED_ROWS. Stopping.");
      break;
    }

    const row = mapRecordToInsertRow(record);

    if (!row.brand_name && !row.generic_name) {
      continue;
    }

    if (!shouldKeepRow({ row, targetDrugSet, rowsByDrug })) {
      continue;
    }

    batch.push(row);
    keptRows += 1;

    if (batch.length >= batchSize) {
      await insertBatch(batch);
      insertedRows += batch.length;
      batch = [];
    }

    if (Date.now() - lastLogAt >= 5000) {
      lastLogAt = Date.now();

      const filledTargetDrugs = Array.from(targetDrugSet).filter(
        (drug) => (rowsByDrug.get(drug) || 0) >= maxRowsPerDrug
      ).length;

      console.log({
        scannedRows,
        keptRows,
        insertedRows,
        batchBuffered: batch.length,
        filledTargetDrugs,
        targetDrugCount: targetDrugSet.size,
      });
    }

    if (keptRows >= maxTotalRows) {
      console.log("Reached CMS_PRESCRIBERS_MAX_TOTAL_ROWS. Stopping.");
      break;
    }

    if (allTargetDrugsFilled(targetDrugSet, rowsByDrug)) {
      console.log("All target drugs reached max rows. Stopping.");
      break;
    }
  }

  if (batch.length > 0) {
    await insertBatch(batch);
    insertedRows += batch.length;
  }

  console.log("FAST CMS Part D Prescribers ingestion complete.");
  console.log({
    scannedRows,
    keptRows,
    insertedRows,
    targetDrugCount: targetDrugSet.size,
    filledTargetDrugs: Array.from(targetDrugSet).filter(
      (drug) => (rowsByDrug.get(drug) || 0) >= maxRowsPerDrug
    ).length,
  });

  console.table(
    Array.from(rowsByDrug.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 40)
      .map(([drug, count]) => ({ drug, count }))
  );
}

main().catch((error) => {
  console.error("FAST CMS Part D Prescribers ingestion failed:", error);
  process.exit(1);
});