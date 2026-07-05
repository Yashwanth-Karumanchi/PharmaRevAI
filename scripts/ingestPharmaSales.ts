import crypto from "crypto";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import readline from "readline";

dotenv.config({ path: ".env.local" });

type CsvRow = Record<string, string>;

type NormalizedSaleRow = {
  row_hash: string;
  sale_timestamp: string | null;
  sale_date: string | null;
  sale_year: number | null;
  sale_month: number | null;
  drug_name: string | null;
  atc_category: string | null;
  quantity_sold: number;
  source_dataset: string;
  source_file: string;
};

const csvPath = process.env.PHARMA_SALES_CSV_PATH || "data/pharma_sales.csv";
const sourceDataset =
  process.env.PHARMA_SALES_SOURCE_DATASET || "Public Pharma Sales Dataset";
const batchSize = Number(process.env.PHARMA_SALES_BATCH_SIZE || 500);
const maxRows = Number(process.env.PHARMA_SALES_MAX_ROWS || 750000);

const dateAliases = [
  "date",
  "datum",
  "sale_date",
  "sales_date",
  "datetime",
  "timestamp",
  "sale_timestamp",
  "transaction_date",
];

const timeAliases = ["time", "sale_time", "transaction_time"];

const drugAliases = [
  "drug_name",
  "brand_name",
  "medicine",
  "medicine_name",
  "product",
  "product_name",
  "item",
  "item_name",
];

const categoryAliases = [
  "atc_category",
  "category",
  "drug_category",
  "product_category",
  "atc",
  "class",
];

const quantityAliases = [
  "quantity",
  "quantity_sold",
  "qty",
  "sold_quantity",
  "sales_quantity",
  "volume",
  "units",
  "sales",
];

function parseCsvLine(line: string) {
  const values: string[] = [];
  let current = "";
  let insideQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const nextChar = line[index + 1];

    if (char === '"' && insideQuotes && nextChar === '"') {
      current += '"';
      index += 1;
      continue;
    }

    if (char === '"') {
      insideQuotes = !insideQuotes;
      continue;
    }

    if (char === "," && !insideQuotes) {
      values.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  values.push(current.trim());

  return values;
}

function normalizeHeader(value: string) {
  return value
    .replace(/^\uFEFF/, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^\w]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
}

function getFirstExistingHeader(headers: string[], aliases: string[]) {
  return aliases.find((alias) => headers.includes(normalizeHeader(alias))) ?? "";
}

function getValue(row: CsvRow, columnName: string) {
  return columnName ? row[columnName]?.trim() ?? "" : "";
}

function toNumber(value: string) {
  if (!value) {
    return null;
  }

  const cleaned = value.replace(/[$,]/g, "").trim();
  const parsed = Number(cleaned);

  return Number.isFinite(parsed) ? parsed : null;
}

function parseDateParts(dateValue: string, timeValue: string) {
  const rawValue = `${dateValue} ${timeValue}`.trim();

  if (!rawValue) {
    return {
      timestamp: null,
      date: null,
      year: null,
      month: null,
    };
  }

  let parsedDate = new Date(rawValue);

  if (Number.isNaN(parsedDate.getTime())) {
    parsedDate = new Date(dateValue);
  }

  if (Number.isNaN(parsedDate.getTime())) {
    const dotMatch = dateValue.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);

    if (dotMatch) {
      parsedDate = new Date(
        `${dotMatch[3]}-${dotMatch[2].padStart(2, "0")}-${dotMatch[1].padStart(
          2,
          "0"
        )}`
      );
    }
  }

  if (Number.isNaN(parsedDate.getTime())) {
    return {
      timestamp: null,
      date: null,
      year: null,
      month: null,
    };
  }

  return {
    timestamp: parsedDate.toISOString(),
    date: parsedDate.toISOString().slice(0, 10),
    year: parsedDate.getUTCFullYear(),
    month: parsedDate.getUTCMonth() + 1,
  };
}

function buildRowHash(row: Omit<NormalizedSaleRow, "row_hash">) {
  return crypto.createHash("sha256").update(JSON.stringify(row)).digest("hex");
}

function isLikelyNumericColumn(values: string[]) {
  const nonEmptyValues = values.filter((value) => value.trim() !== "").slice(0, 30);

  if (nonEmptyValues.length === 0) {
    return false;
  }

  const numericValues = nonEmptyValues.filter((value) => toNumber(value) !== null);

  return numericValues.length / nonEmptyValues.length >= 0.8;
}

function buildNormalizedRow({
  dateValue,
  timeValue,
  drugName,
  atcCategory,
  quantity,
  sourceFile,
}: {
  dateValue: string;
  timeValue: string;
  drugName: string;
  atcCategory: string;
  quantity: number;
  sourceFile: string;
}): NormalizedSaleRow | null {
  if (!Number.isFinite(quantity)) {
    return null;
  }

  const dateParts = parseDateParts(dateValue, timeValue);

  const withoutHash: Omit<NormalizedSaleRow, "row_hash"> = {
    sale_timestamp: dateParts.timestamp,
    sale_date: dateParts.date,
    sale_year: dateParts.year,
    sale_month: dateParts.month,
    drug_name: drugName || null,
    atc_category: atcCategory || null,
    quantity_sold: quantity,
    source_dataset: sourceDataset,
    source_file: sourceFile,
  };

  return {
    row_hash: buildRowHash(withoutHash),
    ...withoutHash,
  };
}

async function insertBatch(rows: NormalizedSaleRow[]) {
  if (rows.length === 0) {
    return 0;
  }

  const { sql } = await import("../lib/db/client");

  await sql`
    insert into pharma_sales ${sql(rows, [
      "row_hash",
      "sale_timestamp",
      "sale_date",
      "sale_year",
      "sale_month",
      "drug_name",
      "atc_category",
      "quantity_sold",
      "source_dataset",
      "source_file",
    ])}
    on conflict (row_hash)
    do nothing
  `;

  return rows.length;
}

async function main() {
  const resolvedPath = path.resolve(csvPath);

  if (!fs.existsSync(resolvedPath)) {
    console.error(`Could not find pharma sales CSV at: ${resolvedPath}`);
    console.error("Create a data folder and place your CSV here:");
    console.error("data/pharma_sales.csv");
    process.exit(1);
  }

  console.log("Starting Pharma Sales ingestion...");
  console.log({
    csvPath: resolvedPath,
    sourceDataset,
    batchSize,
    maxRows,
  });

  const reader = readline.createInterface({
    input: fs.createReadStream(resolvedPath),
    crlfDelay: Infinity,
  });

  let headers: string[] | null = null;
  let rawHeaders: string[] = [];
  let bufferedPreviewRows: CsvRow[] = [];
  let detectedMode: "unknown" | "row" | "wide" = "unknown";

  let dateColumn = "";
  let timeColumn = "";
  let drugColumn = "";
  let categoryColumn = "";
  let quantityColumn = "";
  let wideQuantityColumns: string[] = [];

  let scannedRows = 0;
  let normalizedRows = 0;
  let insertedRows = 0;
  let skippedRows = 0;
  let batch: NormalizedSaleRow[] = [];

  async function flushBatch() {
    if (batch.length === 0) return;

    insertedRows += await insertBatch(batch);
    console.log({
      scannedRows,
      normalizedRows,
      insertedRows,
      skippedRows,
    });
    batch = [];
  }

  async function processCsvRow(row: CsvRow) {
    if (!headers) return;

    scannedRows += 1;

    if (scannedRows > maxRows) {
      return;
    }

    const dateValue = getValue(row, dateColumn);
    const timeValue = getValue(row, timeColumn);

    if (detectedMode === "row") {
      const quantity = toNumber(getValue(row, quantityColumn));

      if (quantity === null) {
        skippedRows += 1;
        return;
      }

      const normalizedRow = buildNormalizedRow({
        dateValue,
        timeValue,
        drugName: getValue(row, drugColumn),
        atcCategory: getValue(row, categoryColumn),
        quantity,
        sourceFile: path.basename(resolvedPath),
      });

      if (!normalizedRow) {
        skippedRows += 1;
        return;
      }

      normalizedRows += 1;
      batch.push(normalizedRow);
    }

    if (detectedMode === "wide") {
      for (const column of wideQuantityColumns) {
        const quantity = toNumber(getValue(row, column));

        if (quantity === null) {
          continue;
        }

        const normalizedRow = buildNormalizedRow({
          dateValue,
          timeValue,
          drugName: "",
          atcCategory: column.toUpperCase(),
          quantity,
          sourceFile: path.basename(resolvedPath),
        });

        if (!normalizedRow) {
          skippedRows += 1;
          continue;
        }

        normalizedRows += 1;
        batch.push(normalizedRow);
      }
    }

    if (batch.length >= batchSize) {
      await flushBatch();
    }
  }

  for await (const line of reader) {
    if (!headers) {
      rawHeaders = parseCsvLine(line);
      headers = rawHeaders.map(normalizeHeader);

      dateColumn = getFirstExistingHeader(headers, dateAliases);
      timeColumn = getFirstExistingHeader(headers, timeAliases);
      drugColumn = getFirstExistingHeader(headers, drugAliases);
      categoryColumn = getFirstExistingHeader(headers, categoryAliases);
      quantityColumn = getFirstExistingHeader(headers, quantityAliases);

      if (!dateColumn) {
        throw new Error(
          `No date column found. Expected one of: ${dateAliases.join(", ")}`
        );
      }

      continue;
    }

    const values = parseCsvLine(line);
    const row: CsvRow = {};

    headers.forEach((header, index) => {
      row[header] = values[index] ?? "";
    });

    if (detectedMode === "unknown") {
      bufferedPreviewRows.push(row);

      if (bufferedPreviewRows.length < 25) {
        continue;
      }

      if (quantityColumn && (drugColumn || categoryColumn)) {
        detectedMode = "row";
      } else {
        const ignoredColumns = new Set([
          dateColumn,
          timeColumn,
          drugColumn,
          categoryColumn,
          quantityColumn,
        ].filter(Boolean));

        wideQuantityColumns = headers.filter((header) => {
          if (ignoredColumns.has(header)) {
            return false;
          }

          return isLikelyNumericColumn(
            bufferedPreviewRows.map((previewRow) => previewRow[header] ?? "")
          );
        });

        if (wideQuantityColumns.length === 0) {
          throw new Error(
            "Could not detect transaction quantity column or wide numeric sales columns."
          );
        }

        detectedMode = "wide";
      }

      console.log("Detected Pharma Sales CSV mode:", detectedMode);
      console.log({
        dateColumn,
        timeColumn,
        drugColumn,
        categoryColumn,
        quantityColumn,
        wideQuantityColumns,
      });

      for (const previewRow of bufferedPreviewRows) {
        await processCsvRow(previewRow);
      }

      bufferedPreviewRows = [];
      continue;
    }

    await processCsvRow(row);

    if (scannedRows >= maxRows) {
      break;
    }
  }

  if (detectedMode === "unknown" && bufferedPreviewRows.length > 0) {
    if (quantityColumn && (drugColumn || categoryColumn)) {
      detectedMode = "row";
    } else {
      const ignoredColumns = new Set([
        dateColumn,
        timeColumn,
        drugColumn,
        categoryColumn,
        quantityColumn,
      ].filter(Boolean));

      wideQuantityColumns = headers.filter((header) => {
        if (ignoredColumns.has(header)) {
          return false;
        }

        return isLikelyNumericColumn(
          bufferedPreviewRows.map((previewRow) => previewRow[header] ?? "")
        );
      });

      detectedMode = "wide";
    }

    for (const previewRow of bufferedPreviewRows) {
      await processCsvRow(previewRow);
    }
  }

  await flushBatch();

  console.log("Pharma Sales ingestion complete.");
  console.log({
    detectedMode,
    scannedRows,
    normalizedRows,
    insertedRows,
    skippedRows,
  });
}

main().catch((error) => {
  console.error("Pharma Sales ingestion failed:", error);
  process.exit(1);
});