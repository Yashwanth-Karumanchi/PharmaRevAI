import fs from "fs";
import path from "path";
import { parse } from "csv-parse/sync";

const filePath =
  process.argv[2] ?? path.join(process.cwd(), "data/raw/cms_part_d_spending.csv");

if (!fs.existsSync(filePath)) {
  console.error(`CSV file not found: ${filePath}`);
  process.exit(1);
}

const fileContent = fs.readFileSync(filePath, "utf8");

const records = parse(fileContent, {
  columns: true,
  skip_empty_lines: true,
  bom: true,
});

if (records.length === 0) {
  console.log("CSV has no rows.");
  process.exit(0);
}

const headers = Object.keys(records[0]);

console.log("\nCSV headers:\n");
console.log(headers.join("\n"));

console.log("\nFirst row preview:\n");
console.log(records[0]);

console.log(`\nTotal rows found: ${records.length}`);