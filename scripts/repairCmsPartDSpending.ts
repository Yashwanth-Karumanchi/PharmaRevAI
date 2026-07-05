import crypto from "crypto";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local", override: true });

type CsvRow = Record<string, string>;

type SpendingInsertRow = {
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
  avg_spending_per_beneficiary: number | null;
  change_avg_spend_per_dosage_unit: number | null;
  source_dataset: string;
  source_url: string;
  metadata: Record<string, unknown>;
};

const sourceUrl =
  process.env.CMS_PARTD_SPENDING_CSV_URL ||
  "https://data.cms.gov/sites/default/files/2026-06/98218f98-166c-4723-8438-c344a4ef96a6/DSD_PTD_RY26_P04_V10_DY24_BGM.csv";

const targetYear = Number(process.env.CMS_PARTD_SPENDING_YEAR || 2024);
const batchSize = Number(process.env.CMS_PARTD_SPENDING_BATCH_SIZE || 750);
const sourceDataset = `CMS Medicare Part D Spending by Drug ${targetYear}`;

function clean(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizeHeader(value: string) {
  return clean(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function parseNumber(value: unknown) {
  const text = clean(value);

  if (!text) return null;

  const lower = text.toLowerCase();

  if (
    lower === "na" ||
    lower === "n/a" ||
    lower === "null" ||
    lower === "none" ||
    lower === "suppressed" ||
    lower === "*"
  ) {
    return null;
  }

  const normalized = text.replace(/[$,%"]/g, "").replace(/,/g, "").trim();

  if (!normalized) return null;

  const parsed = Number(normalized);

  return Number.isFinite(parsed) ? parsed : null;
}

function parseCsv(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let insideQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const nextChar = text[index + 1];

    if (char === '"' && insideQuotes && nextChar === '"') {
      field += '"';
      index += 1;
      continue;
    }

    if (char === '"') {
      insideQuotes = !insideQuotes;
      continue;
    }

    if (char === "," && !insideQuotes) {
      row.push(field);
      field = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !insideQuotes) {
      if (char === "\r" && nextChar === "\n") {
        index += 1;
      }

      row.push(field);
      field = "";

      if (row.some((value) => clean(value))) {
        rows.push(row);
      }

      row = [];
      continue;
    }

    field += char;
  }

  if (field || row.length > 0) {
    row.push(field);

    if (row.some((value) => clean(value))) {
      rows.push(row);
    }
  }

  return rows;
}

function rowsToObjects(rows: string[][]) {
  const [headers, ...dataRows] = rows;

  if (!headers || headers.length === 0) {
    throw new Error("CSV has no headers.");
  }

  const normalizedHeaders = headers.map(normalizeHeader);

  return dataRows.map((row) => {
    const object: CsvRow = {};

    for (let index = 0; index < normalizedHeaders.length; index += 1) {
      object[normalizedHeaders[index]] = clean(row[index]);
    }

    return object;
  });
}

function pick(row: CsvRow, candidates: string[]) {
  for (const candidate of candidates) {
    const key = normalizeHeader(candidate);
    const value = row[key];

    if (value !== undefined && clean(value)) {
      return value;
    }
  }

  return "";
}

function hash(parts: unknown[]) {
  return crypto
    .createHash("sha256")
    .update(parts.map((part) => clean(part).toLowerCase()).join("|"))
    .digest("hex");
}

function buildInsertRow(row: CsvRow): SpendingInsertRow | null {
  const brandName = pick(row, [
    "Brnd_Name",
    "Brand_Name",
    "brand_name",
    "Drug_Name",
    "drug_name",
  ]);

  const genericName = pick(row, [
    "Gnrc_Name",
    "Generic_Name",
    "generic_name",
  ]);

  const manufacturer = pick(row, [
    "Mftr_Name",
    "Manufacturer",
    "manufacturer",
    "manufacturer_name",
  ]);

  const totalSpending = parseNumber(
    pick(row, [
      `Tot_Spndng_${targetYear}`,
      `Total_Spending_${targetYear}`,
      `Total_Spndng_${targetYear}`,
      `Tot_Spending_${targetYear}`,
      "Tot_Spndng",
      "Total_Spending",
      "total_spending",
    ])
  );

  const totalClaims = parseNumber(
    pick(row, [
      `Tot_Clms_${targetYear}`,
      `Total_Claims_${targetYear}`,
      "Tot_Clms",
      "Total_Claims",
      "total_claims",
    ])
  );

  const totalBeneficiaries = parseNumber(
    pick(row, [
      `Tot_Benes_${targetYear}`,
      `Total_Beneficiaries_${targetYear}`,
      "Tot_Benes",
      "Total_Beneficiaries",
      "total_beneficiaries",
    ])
  );

  const totalDosageUnits = parseNumber(
    pick(row, [
      `Tot_Dsg_Unts_${targetYear}`,
      `Total_Dosage_Units_${targetYear}`,
      "Tot_Dsg_Unts",
      "Total_Dosage_Units",
      "total_dosage_units",
    ])
  );

  const avgSpendingPerDosageUnit = parseNumber(
    pick(row, [
      `Avg_Spnd_Per_Dsg_Unt_Wghtd_${targetYear}`,
      `Avg_Spnd_Per_Dsg_Unt_${targetYear}`,
      "Avg_Spnd_Per_Dsg_Unt_Wghtd",
      "Avg_Spnd_Per_Dsg_Unt",
      "avg_spending_per_dosage_unit",
    ])
  );

  const avgSpendingPerClaim = parseNumber(
    pick(row, [
      `Avg_Spnd_Per_Clm_${targetYear}`,
      "Avg_Spnd_Per_Clm",
      "avg_spending_per_claim",
    ])
  );

  const avgSpendingPerBeneficiary = parseNumber(
    pick(row, [
      `Avg_Spnd_Per_Bene_${targetYear}`,
      "Avg_Spnd_Per_Bene",
      "avg_spending_per_beneficiary",
    ])
  );

  const changeAvgSpendPerDosageUnit = parseNumber(
    pick(row, [
      `Chg_Avg_Spnd_Per_Dsg_Unt_${targetYear}`,
      `Chg_Avg_Spnd_Per_Dsg_Unt_${targetYear - 1}_${targetYear}`,
      "Chg_Avg_Spnd_Per_Dsg_Unt",
      "change_avg_spend_per_dosage_unit",
    ])
  );

  if (!brandName && !genericName) {
    return null;
  }

  if (totalSpending === null) {
    return null;
  }

  return {
    row_hash: hash([targetYear, brandName, genericName, manufacturer]),
    year: targetYear,
    brand_name: brandName || null,
    generic_name: genericName || null,
    manufacturer: manufacturer || null,
    total_spending: totalSpending,
    total_claims: totalClaims,
    total_beneficiaries: totalBeneficiaries,
    total_dosage_units: totalDosageUnits,
    avg_spending_per_dosage_unit: avgSpendingPerDosageUnit,
    avg_spending_per_claim: avgSpendingPerClaim,
    avg_spending_per_beneficiary: avgSpendingPerBeneficiary,
    change_avg_spend_per_dosage_unit: changeAvgSpendPerDosageUnit,
    source_dataset: sourceDataset,
    source_url: sourceUrl,
    metadata: {
      sourceDataset,
      sourceUrl,
      targetYear,
      originalRow: row,
    },
  };
}

async function ensureSchema(sql: any) {
  await sql`
    create table if not exists cms_part_d_spending (
      id bigserial primary key
    )
  `;

  await sql`alter table cms_part_d_spending add column if not exists row_hash text`;
  await sql`alter table cms_part_d_spending add column if not exists year integer`;
  await sql`alter table cms_part_d_spending add column if not exists brand_name text`;
  await sql`alter table cms_part_d_spending add column if not exists generic_name text`;
  await sql`alter table cms_part_d_spending add column if not exists manufacturer text`;
  await sql`alter table cms_part_d_spending add column if not exists total_spending numeric`;
  await sql`alter table cms_part_d_spending add column if not exists total_claims numeric`;
  await sql`alter table cms_part_d_spending add column if not exists total_beneficiaries numeric`;
  await sql`alter table cms_part_d_spending add column if not exists total_dosage_units numeric`;
  await sql`alter table cms_part_d_spending add column if not exists avg_spending_per_dosage_unit numeric`;
  await sql`alter table cms_part_d_spending add column if not exists avg_spending_per_claim numeric`;
  await sql`alter table cms_part_d_spending add column if not exists avg_spending_per_beneficiary numeric`;
  await sql`alter table cms_part_d_spending add column if not exists change_avg_spend_per_dosage_unit numeric`;
  await sql`alter table cms_part_d_spending add column if not exists source_dataset text`;
  await sql`alter table cms_part_d_spending add column if not exists source_url text`;
  await sql`alter table cms_part_d_spending add column if not exists metadata jsonb`;
  await sql`alter table cms_part_d_spending add column if not exists created_at timestamptz default now()`;
}

async function insertBatch(sql: any, rows: SpendingInsertRow[]) {
  if (rows.length === 0) return;

  await sql`
    insert into cms_part_d_spending ${sql(
      rows,
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
      "avg_spending_per_beneficiary",
      "change_avg_spend_per_dosage_unit",
      "source_dataset",
      "source_url",
      "metadata"
    )}
  `;
}

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is missing.");
  }

  const { sql } = await import("../lib/db/client");

  console.log("Repairing CMS Part D spending with forced target year...");
  console.log({
    sourceUrl,
    targetYear,
    batchSize,
  });

  await ensureSchema(sql);

  console.log("Downloading CMS Part D spending CSV...");
  const response = await fetch(sourceUrl);

  if (!response.ok) {
    throw new Error(`Download failed: ${response.status} ${response.statusText}`);
  }

  const csvText = await response.text();

  console.log("Parsing CSV...");
  const parsedRows = parseCsv(csvText);
  const csvRows = rowsToObjects(parsedRows);

  console.log({
    csvRows: csvRows.length,
    targetYear,
  });

  const sampleKeys = Object.keys(csvRows[0] || {});
  const targetSpendingKey = normalizeHeader(`Tot_Spndng_${targetYear}`);

  console.log("Sample CSV keys:");
  console.log(sampleKeys.slice(0, 120));

  if (!sampleKeys.includes(targetSpendingKey)) {
    console.warn(`Could not directly find expected key: ${targetSpendingKey}`);
    console.warn(
      "Available spending-like keys:",
      sampleKeys.filter((key) => key.includes("spnd") || key.includes("spend"))
    );
  }

  const insertRows = csvRows
    .map((row) => buildInsertRow(row))
    .filter((row): row is SpendingInsertRow => Boolean(row));

  console.log({
    rowsWithParsedTargetYearSpending: insertRows.length,
    skippedRows: csvRows.length - insertRows.length,
  });

  if (insertRows.length === 0) {
    console.log("Sample row:");
    console.dir(csvRows[0], { depth: 2 });
    throw new Error(
      `No rows parsed for target year ${targetYear}. Header mapping needs adjustment.`
    );
  }

  console.log("Truncating old cms_part_d_spending rows...");
  await sql`truncate table cms_part_d_spending restart identity`;

  console.log("Inserting repaired rows...");
  for (let index = 0; index < insertRows.length; index += batchSize) {
    const batch = insertRows.slice(index, index + batchSize);
    await insertBatch(sql, batch);

    console.log(`Inserted ${Math.min(index + batch.length, insertRows.length)} / ${insertRows.length}`);
  }

  console.log("Creating indexes...");
  await sql`
    create index if not exists idx_cms_part_d_spending_year_total
    on cms_part_d_spending (year, total_spending desc)
  `;

  await sql`
    create index if not exists idx_cms_part_d_spending_brand_lower
    on cms_part_d_spending (lower(brand_name))
  `;

  await sql`
    create index if not exists idx_cms_part_d_spending_generic_lower
    on cms_part_d_spending (lower(generic_name))
  `;

  console.log("Verification: year counts");
  const yearCounts = await sql`
    select
      year,
      count(*)::int as total_rows,
      count(total_spending)::int as rows_with_total_spending,
      sum(total_spending)::numeric(18, 2) as total_spending_sum
    from cms_part_d_spending
    group by year
    order by year
  `;
  console.table(yearCounts);

  console.log("Verification: top 2024 rows");
  const topRows = await sql`
    select
      brand_name,
      generic_name,
      manufacturer,
      total_spending,
      total_claims,
      total_beneficiaries,
      year
    from cms_part_d_spending
    where year = ${targetYear}
      and total_spending is not null
    order by total_spending desc nulls last
    limit 10
  `;
  console.table(topRows);

  if (topRows.length === 0) {
    throw new Error(`Repair finished but no top rows exist for ${targetYear}.`);
  }

  console.log("CMS Part D spending repair complete.");
}

main().catch((error) => {
  console.error("CMS Part D spending repair failed:");
  console.error(error);
  process.exit(1);
});