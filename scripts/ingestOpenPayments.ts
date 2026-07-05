import dotenv from "dotenv";
import crypto from "crypto";
import { Readable } from "stream";
import { parse } from "csv-parse";

dotenv.config({ path: ".env.local" });

type CsvRecord = Record<string, string>;

type InsertRow = {
  row_hash: string;
  program_year: number;
  company_name: string | null;
  covered_recipient_type: string | null;
  recipient_name: string | null;
  recipient_npi: string | null;
  physician_specialty: string | null;
  recipient_city: string | null;
  recipient_state: string | null;
  payment_amount: number | null;
  payment_nature: string | null;
  payment_form: string | null;
  drug_or_device_name: string | null;
  date_of_payment: string | null;
  source_dataset: string;
  source_url: string;
  metadata: unknown;
};

const programYear = Number(process.env.OPEN_PAYMENTS_PROGRAM_YEAR || 2024);
const csvUrl =
  process.env.OPEN_PAYMENTS_CSV_URL ||
  "https://download.cms.gov/openpayments/PGYR2024_P01232026_01102026/OP_DTL_GNRL_PGYR2024_P01232026_01102026.csv";

const maxRows = Number(process.env.OPEN_PAYMENTS_MAX_ROWS || 500000);
const maxScannedRows = Number(process.env.OPEN_PAYMENTS_MAX_SCANNED_ROWS || 3000000);
const batchSize = Number(process.env.OPEN_PAYMENTS_BATCH_SIZE || 2000);
const insertColumnCount = 17;
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
const includeEveryNthRow = Number(process.env.OPEN_PAYMENTS_INCLUDE_EVERY_NTH_ROW || 5);

const extraTerms = (process.env.OPEN_PAYMENTS_EXTRA_TERMS || "")
  .split(",")
  .map((term) => term.trim().toLowerCase())
  .filter(Boolean);

const sourceDataset = "CMS Open Payments General Payment Data";

function clean(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function textOrNull(value: unknown) {
  const cleaned = clean(value);
  return cleaned ? cleaned : null;
}

function numberOrNull(value: unknown) {
  const cleaned = clean(value).replace(/[$,]/g, "");

  if (!cleaned) {
    return null;
  }

  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseDate(value: unknown) {
  const cleaned = clean(value);

  if (!cleaned) {
    return null;
  }

  const parsed = new Date(cleaned);

  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toISOString().slice(0, 10);
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

function buildRecipientName(record: CsvRecord) {
  const first = clean(getField(record, ["Covered_Recipient_First_Name", "Covered Recipient First Name"]));
  const middle = clean(getField(record, ["Covered_Recipient_Middle_Name", "Covered Recipient Middle Name"]));
  const last = clean(getField(record, ["Covered_Recipient_Last_Name", "Covered Recipient Last Name"]));
  const org = clean(getField(record, ["Teaching_Hospital_Name", "Teaching Hospital Name"]));

  const name = [first, middle, last].filter(Boolean).join(" ");
  return name || org || null;
}

function buildDrugOrDeviceName(record: CsvRecord) {
  const names = [
    "Name_of_Associated_Covered_Drug_or_Biological1",
    "Name_of_Associated_Covered_Drug_or_Biological2",
    "Name_of_Associated_Covered_Drug_or_Biological3",
    "Name_of_Associated_Covered_Drug_or_Biological4",
    "Name_of_Associated_Covered_Drug_or_Biological5",
    "Name_of_Associated_Covered_Device_or_Medical_Supply1",
    "Name_of_Associated_Covered_Device_or_Medical_Supply2",
    "Name_of_Associated_Covered_Device_or_Medical_Supply3",
    "Name_of_Associated_Covered_Device_or_Medical_Supply4",
    "Name_of_Associated_Covered_Device_or_Medical_Supply5",
  ];

  const values = names.map((name) => clean(getField(record, [name]))).filter(Boolean);
  return values.length > 0 ? Array.from(new Set(values)).join("; ") : null;
}

function mapRecord(record: CsvRecord): InsertRow {
  const companyName = textOrNull(
    getField(record, [
      "Applicable_Manufacturer_or_Applicable_GPO_Making_Payment_Name",
      "Applicable Manufacturer or Applicable GPO Making Payment Name",
    ])
  );

  const coveredRecipientType = textOrNull(
    getField(record, ["Covered_Recipient_Type", "Covered Recipient Type"])
  );

  const recipientName = buildRecipientName(record);

  const recipientNpi = textOrNull(
    getField(record, ["Covered_Recipient_NPI", "Covered Recipient NPI"])
  );

  const physicianSpecialty = textOrNull(
    getField(record, [
      "Physician_Specialty",
      "Physician Specialty",
      "Covered_Recipient_Specialty_1",
    ])
  );

  const recipientCity = textOrNull(
    getField(record, ["Recipient_City", "Recipient City"])
  );

  const recipientState = textOrNull(
    getField(record, ["Recipient_State", "Recipient State"])
  );

  const paymentAmount = numberOrNull(
    getField(record, ["Total_Amount_of_Payment_USDollars", "Total Amount of Payment US Dollars"])
  );

  const paymentNature = textOrNull(
    getField(record, [
      "Nature_of_Payment_or_Transfer_of_Value",
      "Nature of Payment or Transfer of Value",
    ])
  );

  const paymentForm = textOrNull(
    getField(record, [
      "Form_of_Payment_or_Transfer_of_Value",
      "Form of Payment or Transfer of Value",
    ])
  );

  const drugOrDeviceName = buildDrugOrDeviceName(record);

  const dateOfPayment = parseDate(
    getField(record, ["Date_of_Payment", "Date of Payment"])
  );

  const rowHash = hashParts([
    programYear,
    companyName,
    recipientName,
    recipientNpi,
    physicianSpecialty,
    recipientCity,
    recipientState,
    paymentAmount,
    paymentNature,
    paymentForm,
    drugOrDeviceName,
    dateOfPayment,
  ]);

  return {
    row_hash: rowHash,
    program_year: programYear,
    company_name: companyName,
    covered_recipient_type: coveredRecipientType,
    recipient_name: recipientName,
    recipient_npi: recipientNpi,
    physician_specialty: physicianSpecialty,
    recipient_city: recipientCity,
    recipient_state: recipientState,
    payment_amount: paymentAmount,
    payment_nature: paymentNature,
    payment_form: paymentForm,
    drug_or_device_name: drugOrDeviceName,
    date_of_payment: dateOfPayment,
    source_dataset: sourceDataset,
    source_url: csvUrl,
    metadata: {
      ingestionMode: "csv_fast",
      programYear,
    },
  };
}

function shouldKeepRow(record: CsvRecord, mapped: InsertRow, scannedRows: number) {
  if (extraTerms.length === 0) {
    return includeEveryNthRow <= 1 || scannedRows % includeEveryNthRow === 0;
  }

  const combined = [
    mapped.company_name,
    mapped.recipient_name,
    mapped.physician_specialty,
    mapped.drug_or_device_name,
    mapped.payment_nature,
    mapped.recipient_state,
    JSON.stringify(record),
  ]
    .join(" ")
    .toLowerCase();

  const matchesExtraTerm = extraTerms.some((term) => combined.includes(term));

  if (matchesExtraTerm) {
    return true;
  }

  return includeEveryNthRow <= 1 || scannedRows % includeEveryNthRow === 0;
}

async function insertBatch(rows: InsertRow[]) {
  if (rows.length === 0) {
    return;
  }

  const { sql } = await import("../lib/db/client");

  for (const chunk of chunkRows(rows, effectiveInsertBatchSize)) {
    await sql`
      insert into open_payments ${sql(
        chunk,
        "row_hash",
        "program_year",
        "company_name",
        "covered_recipient_type",
        "recipient_name",
        "recipient_npi",
        "physician_specialty",
        "recipient_city",
        "recipient_state",
        "payment_amount",
        "payment_nature",
        "payment_form",
        "drug_or_device_name",
        "date_of_payment",
        "source_dataset",
        "source_url",
        "metadata"
      )}
      on conflict (row_hash) do nothing
    `;
  }
}

async function getCsvStream() {
  console.log("Opening Open Payments CSV stream...");
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

  console.log("Starting FAST Open Payments ingestion...");
  console.log({
    programYear,
    maxRows,
    maxScannedRows,
    requestedBatchSize: batchSize,
    effectiveInsertBatchSize,
    includeEveryNthRow,
    extraTerms,
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
  let lastLogAt = Date.now();

  for await (const record of parser as AsyncIterable<CsvRecord>) {
    scannedRows += 1;

    if (scannedRows > maxScannedRows) {
      console.log("Reached OPEN_PAYMENTS_MAX_SCANNED_ROWS. Stopping.");
      break;
    }

    const mapped = mapRecord(record);

    if (!mapped.company_name && !mapped.payment_amount) {
      continue;
    }

    if (!shouldKeepRow(record, mapped, scannedRows)) {
      continue;
    }

    batch.push(mapped);
    keptRows += 1;

    if (batch.length >= batchSize) {
      await insertBatch(batch);
      insertedRows += batch.length;
      batch = [];
    }

    if (Date.now() - lastLogAt >= 5000) {
      lastLogAt = Date.now();
      console.log({ scannedRows, keptRows, insertedRows, batchBuffered: batch.length });
    }

    if (keptRows >= maxRows) {
      console.log("Reached OPEN_PAYMENTS_MAX_ROWS. Stopping.");
      break;
    }
  }

  if (batch.length > 0) {
    await insertBatch(batch);
    insertedRows += batch.length;
  }

  console.log("FAST Open Payments ingestion complete.");
  console.log({ scannedRows, keptRows, insertedRows });
}

main().catch((error) => {
  console.error("FAST Open Payments ingestion failed:", error);
  process.exit(1);
});