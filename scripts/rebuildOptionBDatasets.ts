import dotenv from "dotenv";
import fs from "fs";
import { spawn } from "child_process";

dotenv.config({ path: ".env.local" });

type Step = {
  name: string;
  script: string;
  required: boolean;
  skipWhen?: () => boolean;
};

const isWindows = process.platform === "win32";

const steps: Step[] = [
  {
    name: "Optional schema setup",
    script: "setup:max-schema",
    required: true,
    skipWhen: () => process.env.OPTION_B_RUN_SCHEMA_SETUP !== "true",
  },
  {
    name: "Prepare Option B compact database",
    script: "prepare:option-b",
    required: true,
  },
  {
    name: "Ensure old data contract before ingestion",
    script: "ensure:data-contract",
    required: true,
  },
  {
    name: "Ingest CMS Part D Spending",
    script: "ingest:cms-spending",
    required: true,
  },
  {
    name: "Ingest CMS Part D Prescribers compact fast stream",
    script: "ingest:cms-prescribers",
    required: true,
  },
  {
    name: "Ingest Open Payments compact storage-aware stream",
    script: "ingest:open-payments",
    required: true,
  },
  {
    name: "Ingest Pharma Sales",
    script: "ingest:pharma-sales",
    required: true,
  },
  {
    name: "Ingest openFDA wide compact labels",
    script: "ingest:openfda-wide-labels",
    required: true,
  },
  {
    name: "Optional targeted openFDA labels",
    script: "ingest:openfda-targeted-labels",
    required: false,
  },
  {
    name: "Restore old data contract after openFDA ingestion",
    script: "ensure:data-contract",
    required: true,
  },
  {
    name: "Optional RAG data debug before embeddings",
    script: "debug:rag-data",
    required: false,
  },
  {
    name: "Build local BGE embeddings",
    script: "embed:chunks",
    required: true,
  },
  {
    name: "Restore old data contract after embeddings",
    script: "ensure:data-contract",
    required: true,
  },
  {
    name: "Optimize Option B compact database",
    script: "optimize:option-b",
    required: true,
  },
  {
    name: "Check dataset counts",
    script: "check:dataset-counts",
    required: true,
  },
  {
    name: "Generate diverse 1000-question evaluation set",
    script: "generate:eval-questions",
    required: true,
  },
  {
    name: "Database storage report",
    script: "db:size",
    required: true,
  },
];

function getCleanEnv() {
  const cleanEnv: NodeJS.ProcessEnv = {};

  for (const [key, value] of Object.entries(process.env)) {
    if (!key || key.includes("=")) {
      continue;
    }

    if (value === undefined || value === null) {
      continue;
    }

    cleanEnv[key] = String(value);
  }

  return cleanEnv;
}

function getPackageJson() {
  const raw = fs.readFileSync("package.json", "utf-8");
  return JSON.parse(raw) as { scripts?: Record<string, string> };
}

function hasScript(script: string) {
  const packageJson = getPackageJson();
  return Boolean(packageJson.scripts?.[script]);
}

function runScript(step: Step) {
  return new Promise<void>((resolve, reject) => {
    if (step.skipWhen?.()) {
      console.log("");
      console.log(`Skipping: ${step.name}`);
      resolve();
      return;
    }

    if (!hasScript(step.script)) {
      if (step.required) {
        reject(new Error(`Missing package.json script: ${step.script}`));
        return;
      }

      console.log("");
      console.log(`Skipping optional step because script is missing: ${step.script}`);
      resolve();
      return;
    }

    console.log("");
    console.log("====================================================");
    console.log(`Starting: ${step.name}`);
    console.log(`npm run ${step.script}`);
    console.log("====================================================");

    const startedAt = Date.now();

    const child = isWindows
      ? spawn("cmd.exe", ["/d", "/s", "/c", `npm run ${step.script}`], {
          stdio: "inherit",
          env: getCleanEnv(),
          cwd: process.cwd(),
          windowsHide: false,
        })
      : spawn("npm", ["run", step.script], {
          stdio: "inherit",
          env: getCleanEnv(),
          cwd: process.cwd(),
        });

    child.on("error", reject);

    child.on("close", (code) => {
      const seconds = Math.round((Date.now() - startedAt) / 1000);

      if (code === 0) {
        console.log("");
        console.log(`Finished: ${step.name} in ${seconds}s`);
        resolve();
        return;
      }

      reject(new Error(`${step.name} failed with exit code ${code}`));
    });
  });
}

async function main() {
  console.log("Starting Option B compact PharmaRev rebuild.");
  console.log({
    platform: process.platform,
    nodeVersion: process.version,
    PHARMAREV_DATA_MODE: process.env.PHARMAREV_DATA_MODE,
    NEON_PROJECT_SIZE_LIMIT_MB: process.env.NEON_PROJECT_SIZE_LIMIT_MB,
    NEON_CHAT_RESERVE_MB: process.env.NEON_CHAT_RESERVE_MB,
    NEON_STOP_WRITES_AT_MB: process.env.NEON_STOP_WRITES_AT_MB,
    CMS_PRESCRIBERS_MAX_TOTAL_ROWS: process.env.CMS_PRESCRIBERS_MAX_TOTAL_ROWS,
    OPEN_PAYMENTS_MAX_ROWS: process.env.OPEN_PAYMENTS_MAX_ROWS,
    OPENFDA_MAX_RECORDS: process.env.OPENFDA_MAX_RECORDS,
    OPENFDA_MAX_CHUNKS_PER_DOCUMENT: process.env.OPENFDA_MAX_CHUNKS_PER_DOCUMENT,
    EVAL_QUESTION_COUNT: process.env.EVAL_QUESTION_COUNT,
  });

  const salesPath = process.env.PHARMA_SALES_CSV_PATH || "data/pharma_sales.csv";

  if (!fs.existsSync(salesPath)) {
    throw new Error(
      `Missing pharma sales CSV at ${salesPath}. Download it manually and place it there before rebuild.`
    );
  }

  const startedAt = Date.now();

  for (const step of steps) {
    await runScript(step);
  }

  const minutes = Number(((Date.now() - startedAt) / 60000).toFixed(2));

  console.log("");
  console.log("Option B compact rebuild complete.");
  console.log({ minutes });
  console.log("");
  console.log("Next:");
  console.log("npm run test:planner");
  console.log("npm run test:registry");
  console.log('npm run test:retrieval -- "What is Anoro Ellipta used for?"');
  console.log("npm run eval -- evaluation/questions.generated.1000.json");
}

main().catch((error) => {
  console.error("Option B compact rebuild failed:", error);
  process.exit(1);
});