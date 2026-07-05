import dotenv from "dotenv";
import crypto from "crypto";
import { Readable } from "stream";
import { parse } from "csv-parse";

dotenv.config({ path: ".env.local" });

type CsvRecord = Record<string, string>;

type InsertRow = {
  row_hash: string;
  year: number;
  brand_name: string | null;
  generic_name: string | null;
  manufacturer: string | null;
  total_spending: number | null;
  total_claims: number | null;
  total_beneficiaries: number | null;
  total_dosage_units: number | null;
  avg_spending_per_dosage_unit: number | null;
  avg_spending_per_claim: number | null;
  change_avg_spend_per_dosage_unit: number | null;
  source_dataset: string;
  source_url: string;
  metadata: unknown;
};

const csvUrl =
  process.env.CMS_PARTD_SPENDING_CSV_URL ||
  "https://data.cms.gov/sites/default/files/2026-06/98218f98-166c-4723-8438-c344a4ef96a6/DSD_PTD_RY26_P04_V10_DY24_BGM.csv";

const defaultYear = Number(process.env.CMS_PARTD_SPENDING_YEAR || 2024);
const batchSize = Number(process.env.CMS_PARTD_SPENDING_BATCH_SIZE || 5000);
const insertColumnCount = 15;
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
const maxRows = Number(process.env.CMS_PARTD_SPENDING_MAX_ROWS || 1000000);
const sourceDataset = "CMS Medicare Part D Spending by Drug";

function clean(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function textOrNull(value: unknown) {
  const cleaned = clean(value);
  return cleaned ? cleaned : null;
}

function numberOrNull(value: unknown) {
  const cleaned = clean(value).replace(/[$,%]/g, "").replace(/,/g, "");

  if (!cleaned) {
    return null;
  }

  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
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

function hashParts(parts: Array<string | number | null>) {
  return crypto
    .createHash("sha256")
    .update(parts.map((part) => String(part ?? "")).join("|"))
    .digest("hex");
}

function mapRecord(record: CsvRecord): InsertRow {
  const year =
    numberOrNull(
      getField(record, [
        "Year",
        "year",
        "Rndrng_Prvdr_Year",
        "Data_Year",
        "Drug Year",
      ])
    ) || defaultYear;

  const brandName = textOrNull(
    getField(record, [
      "Brnd_Name",
      "Brnd Name",
      "Brand Name",
      "brand_name",
      "Brand_Name",
    ])
  );

  const genericName = textOrNull(
    getField(record, [
      "Gnrc_Name",
      "Gnrc Name",
      "Generic Name",
      "generic_name",
      "Generic_Name",
    ])
  );

  const manufacturer = textOrNull(
    getField(record, [
      "Mftr_Name",
      "Mftr Name",
      "Manufacturer",
      "manufacturer",
      "Manufacturer Name",
    ])
  );

  const totalSpending = numberOrNull(
    getField(record, [
      "Tot_Spndng",
      "Tot Spndng",
      "Total Spending",
      "total_spending",
      "Tot_Mdcr_Spndng",
      "Tot_Spending",
    ])
  );

  const totalClaims = numberOrNull(
    getField(record, [
      "Tot_Clms",
      "Tot Clms",
      "Total Claims",
      "total_claims",
    ])
  );

  const totalBeneficiaries = numberOrNull(
    getField(record, [
      "Tot_Benes",
      "Tot Benes",
      "Total Beneficiaries",
      "total_beneficiaries",
    ])
  );

  const totalDosageUnits = numberOrNull(
    getField(record, [
      "Tot_Dsg_Unts",
      "Tot Dsg Unts",
      "Total Dosage Units",
      "total_dosage_units",
    ])
  );

  const avgSpendingPerDosageUnit = numberOrNull(
    getField(record, [
      "Avg_Spnd_Per_Dsg_Unt_Wghtd",
      "Avg Spnd Per Dsg Unt Wghtd",
      "Avg_Spnd_Per_Dsg_Unt",
      "Average Spending Per Dosage Unit",
      "avg_spending_per_dosage_unit",
    ])
  );

  const avgSpendingPerClaim = numberOrNull(
    getField(record, [
      "Avg_Spnd_Per_Clm",
      "Avg Spnd Per Clm",
      "Average Spending Per Claim",
      "avg_spending_per_claim",
    ])
  );

  const changeAvgSpend = numberOrNull(
    getField(record, [
      "Chg_Avg_Spnd_Per_Dsg_Unt",
      "Chg Avg Spnd Per Dsg Unt",
      "Change Average Spending Per Dosage Unit",
      "change_avg_spend_per_dosage_unit",
    ])
  );

  const rowHash = hashParts([
    year,
    brandName,
    genericName,
    manufacturer,
    totalSpending,
    totalClaims,
    totalBeneficiaries,
    totalDosageUnits,
  ]);

  return {
    row_hash: rowHash,
    year,
    brand_name: brandName,
    generic_name: genericName,
    manufacturer,
    total_spending: totalSpending,
    total_claims: totalClaims,
    total_beneficiaries: totalBeneficiaries,
    total_dosage_units: totalDosageUnits,
    avg_spending_per_dosage_unit: avgSpendingPerDosageUnit,
    avg_spending_per_claim: avgSpendingPerClaim,
    change_avg_spend_per_dosage_unit: changeAvgSpend,
    source_dataset: sourceDataset,
    source_url: csvUrl,
    metadata: {
      ingestionMode: "csv_fast",
      originalColumns: Object.keys(record),
    },
  };
}

async function insertBatch(rows: InsertRow[]) {
  if (rows.length === 0) {
    return;
  }

  const { sql } = await import("../lib/db/client");

  for (const chunk of chunkRows(rows, effectiveInsertBatchSize)) {
    await sql`
      insert into cms_part_d_spending ${sql(
        chunk,
        "row_hash",
        "year",
        "brand_name",
        "generic_name",
        "manufacturer",
        "total_spending",
        "total_claims",
        "total_beneficiaries",
        "total_dosage_units",
        "avg_spending_per_dosage_unit",
        "avg_spending_per_claim",
        "change_avg_spend_per_dosage_unit",
        "source_dataset",
        "source_url",
        "metadata"
      )}
      on conflict (row_hash) do nothing
    `;
  }
}

async function getCsvStream() {
  console.log("Opening CMS Part D Spending CSV stream...");
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

  console.log("Starting FAST CMS Part D Spending ingestion...");
  console.log({
    defaultYear,
    requestedBatchSize: batchSize,
    effectiveInsertBatchSize,
    maxRows,
  });

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

  let scannedRows = 0;
  let keptRows = 0;
  let insertedRows = 0;
  let batch: InsertRow[] = [];
  let lastLog = Date.now();

  for await (const record of parser as AsyncIterable<CsvRecord>) {
    scannedRows += 1;

    const row = mapRecord(record);

    if (!row.brand_name && !row.generic_name) {
      continue;
    }

    batch.push(row);
    keptRows += 1;

    if (batch.length >= batchSize) {
      await insertBatch(batch);
      insertedRows += batch.length;
      batch = [];
    }

    if (Date.now() - lastLog > 5000) {
      lastLog = Date.now();
      console.log({ scannedRows, keptRows, insertedRows, batchBuffered: batch.length });
    }

    if (keptRows >= maxRows) {
      console.log("Reached CMS_PARTD_SPENDING_MAX_ROWS. Stopping.");
      break;
    }
  }

  if (batch.length > 0) {
    await insertBatch(batch);
    insertedRows += batch.length;
  }

  console.log("FAST CMS Part D Spending ingestion complete.");
  console.log({ scannedRows, keptRows, insertedRows });
}

main().catch((error) => {
  console.error("FAST CMS Part D Spending ingestion failed:", error);
  process.exit(1);
});