import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import postgres from "postgres";
import { parse } from "csv-parse/sync";

dotenv.config({ path: ".env.local" });

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("Missing DATABASE_URL in .env.local");
}

const sql = postgres(databaseUrl, {
  ssl: "require",
});

const filePath =
  process.argv[2] ?? path.join(process.cwd(), "data/raw/cms_part_d_spending.csv");

const maxSourceRows = Number(process.argv[3] ?? 1000);

if (!fs.existsSync(filePath)) {
  console.error(`CSV file not found: ${filePath}`);
  process.exit(1);
}

function normalizeKey(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function findColumn(headers: string[], candidates: string[]) {
  const normalizedHeaders = headers.map((header) => ({
    original: header,
    normalized: normalizeKey(header),
  }));

  for (const candidate of candidates) {
    const normalizedCandidate = normalizeKey(candidate);

    const exactMatch = normalizedHeaders.find(
      (header) => header.normalized === normalizedCandidate
    );

    if (exactMatch) return exactMatch.original;
  }

  for (const candidate of candidates) {
    const normalizedCandidate = normalizeKey(candidate);

    const partialMatch = normalizedHeaders.find((header) =>
      header.normalized.includes(normalizedCandidate)
    );

    if (partialMatch) return partialMatch.original;
  }

  return null;
}

function parseNumber(value: unknown) {
  if (value === null || value === undefined) return null;

  const cleaned = String(value)
    .replaceAll("$", "")
    .replaceAll(",", "")
    .replaceAll("%", "")
    .trim();

  if (!cleaned || cleaned.toLowerCase() === "nan" || cleaned === "*") {
    return null;
  }

  const parsed = Number(cleaned);

  return Number.isFinite(parsed) ? parsed : null;
}

function detectYearColumns(headers: string[]) {
  const yearMap = new Map<
    number,
    {
      totalSpending?: string;
      totalClaims?: string;
      totalBeneficiaries?: string;
      avgSpendingPerDosageUnit?: string;
    }
  >();

  for (const header of headers) {
    const normalized = normalizeKey(header);
    const yearMatch = normalized.match(/(20\d{2})$/);

    if (!yearMatch) continue;

    const year = Number(yearMatch[1]);

    if (!yearMap.has(year)) {
      yearMap.set(year, {});
    }

    const yearColumns = yearMap.get(year)!;

    if (normalized.includes("totspndng") || normalized.includes("totalspending")) {
      yearColumns.totalSpending = header;
    }

    if (normalized.includes("totclms") || normalized.includes("totalclaims")) {
      yearColumns.totalClaims = header;
    }

    if (normalized.includes("totbenes") || normalized.includes("totalbeneficiaries")) {
      yearColumns.totalBeneficiaries = header;
    }

    if (
      normalized.includes("avgspndperdsgunt") ||
      normalized.includes("averagespendingperdosageunit")
    ) {
      yearColumns.avgSpendingPerDosageUnit = header;
    }
  }

  return [...yearMap.entries()]
    .filter(([, columns]) => columns.totalSpending)
    .sort(([yearA], [yearB]) => yearA - yearB);
}

async function main() {
  const fileContent = fs.readFileSync(filePath, "utf8");

  const records = parse(fileContent, {
    columns: true,
    skip_empty_lines: true,
    bom: true,
  }) as Record<string, string>[];

  if (records.length === 0) {
    console.log("No CSV rows found.");
    return;
  }

  const headers = Object.keys(records[0]);

  const brandColumn = findColumn(headers, [
    "Brnd_Name",
    "Brand_Name",
    "Brand Name",
    "brnd_name",
  ]);

  const genericColumn = findColumn(headers, [
    "Gnrc_Name",
    "Generic_Name",
    "Generic Name",
    "gnrc_name",
  ]);

  const manufacturerColumn = findColumn(headers, [
    "Mftr_Name",
    "Manufacturer",
    "Manufacturer Name",
    "mftr_name",
  ]);

  const drugUsesColumn = findColumn(headers, [
    "Drug_Uses",
    "Drug Uses",
    "Uses",
    "Drug Description",
  ]);

  const clinicalIndicationsColumn = findColumn(headers, [
    "Clinical_Indications",
    "Clinical Indications",
    "Indications",
  ]);

  if (!brandColumn || !genericColumn) {
    console.log("Could not find required brand/generic columns.");
    console.log("Available headers:");
    console.log(headers);
    process.exit(1);
  }

  const yearColumns = detectYearColumns(headers);

  if (yearColumns.length === 0) {
    console.log("Could not detect yearly spending columns.");
    console.log("Available headers:");
    console.log(headers);
    process.exit(1);
  }

  console.log("Detected columns:");
  console.log({
    brandColumn,
    genericColumn,
    manufacturerColumn,
    drugUsesColumn,
    clinicalIndicationsColumn,
    years: yearColumns.map(([year]) => year),
  });

  console.log("\nClearing old cms_part_d_spending rows...");
  await sql`truncate table cms_part_d_spending restart identity`;

  let insertedRows = 0;
  const sourceRows = records.slice(0, maxSourceRows);

  for (const row of sourceRows) {
    const brandName = row[brandColumn]?.trim() || null;
    const genericName = row[genericColumn]?.trim() || null;
    const manufacturer = manufacturerColumn
      ? row[manufacturerColumn]?.trim() || null
      : null;
    const drugUses = drugUsesColumn ? row[drugUsesColumn]?.trim() || null : null;
    const clinicalIndications = clinicalIndicationsColumn
      ? row[clinicalIndicationsColumn]?.trim() || null
      : null;

    for (const [year, columns] of yearColumns) {
      const totalSpending = parseNumber(row[columns.totalSpending]);
      const totalClaims = parseNumber(row[columns.totalClaims]);
      const totalBeneficiaries = parseNumber(row[columns.totalBeneficiaries]);
      const avgSpendingPerDosageUnit = parseNumber(
        row[columns.avgSpendingPerDosageUnit]
      );

      if (totalSpending === null) continue;

      await sql`
        insert into cms_part_d_spending (
          year,
          brand_name,
          generic_name,
          manufacturer,
          total_spending,
          total_claims,
          total_beneficiaries,
          avg_spending_per_dosage_unit,
          change_in_avg_spending,
          drug_uses,
          clinical_indications,
          source_dataset
        )
        values (
          ${year},
          ${brandName},
          ${genericName},
          ${manufacturer},
          ${totalSpending},
          ${totalClaims},
          ${totalBeneficiaries},
          ${avgSpendingPerDosageUnit},
          ${null},
          ${drugUses},
          ${clinicalIndications},
          ${"CMS Medicare Part D Spending by Drug"}
        )
      `;

      insertedRows += 1;
    }
  }

  console.log(`\nDone. Inserted ${insertedRows} rows into Neon.`);
  console.log(`Source rows processed: ${sourceRows.length}`);
  console.log("Table: cms_part_d_spending");

  await sql.end();
}

main().catch(async (error) => {
  console.error(error);
  await sql.end();
  process.exit(1);
});